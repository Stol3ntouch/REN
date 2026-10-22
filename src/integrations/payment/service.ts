import { randomUUID } from 'node:crypto';
import { orderAccessPath, orderAccessToken } from '@/domain/ordering/access-token';
import { orders } from '@/domain/ordering/orders';
import type { Order } from '@/domain/ordering/types';
import { getDb, type Db } from '@/server/db/connection';
import { methodsRepo } from '@/server/db/repositories/methods';
import { ordersRepo } from '@/server/db/repositories/orders';
import { paymentsRepo } from '@/server/db/repositories/payments';
import { webhookEventsRepo, type WebhookOutcome } from '@/server/db/repositories/webhook-events';
import { ConflictError } from '@/server/http/errors';
import { getPaymentPort, isProductionEnv } from './select';
import { PaymentTimeoutError, PaymentUnavailableError, type PaymentPort } from './types';

export type ServiceOpts = {
  db?: Db;
  port?: PaymentPort;
  now?: number;
  /** Секрет подписи ссылок на заказ (SESSION_SECRET); в тестах подменяется. */
  secret?: string;
  timeoutMs?: number;
  attempts?: number;
  retryDelayMs?: number;
  production?: boolean;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_WEBHOOK_BYTES = 64 * 1024;
const SYSTEM_ZERO = { type: 'system', reason: 'zero_total' } as const;

/**
 * Журнал запусков интеграций. Таблицу integration_run создаёт T10; пока её нет, ошибки видны в
 * payments (status='error') и webhook_events (outcome 'alert'/'error'). T10 может подключить запись в integration_run.
 */
export type PaymentRunEntry = { kind: 'create_payment' | 'webhook' | 'refund'; ok: boolean; orderId?: number; code?: string; message?: string };
let runLogger: ((e: PaymentRunEntry) => void) | null = null;
export function setPaymentRunLogger(fn: ((e: PaymentRunEntry) => void) | null): void {
  runLogger = fn;
}
const logRun = (e: PaymentRunEntry): void => {
  try {
    runLogger?.(e);
  } catch {
    /* журнал не должен ломать оплату */
  }
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PaymentTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Сообщение для журнала без внутренностей чужого исключения (в нём могут быть адреса и ключи). */
function safeMessage(e: unknown): string {
  if (e instanceof PaymentTimeoutError || e instanceof PaymentUnavailableError) return e.message;
  return `Ошибка обращения к провайдеру (${e instanceof Error ? e.name : 'unknown'})`;
}

const isSafeRelative = (url: string): boolean => url.startsWith('/') && !url.startsWith('//');

/**
 * Старт платежа после оформления заказа с онлайн-оплатой. Возвращает redirectUrl либо null
 * (заказ остаётся «ожидает оплаты», ошибка записана в payments со статусом error).
 *  - не создаёт второй платёж: есть ожидающий — вернёт его ссылку;
 *  - итог 0 ₽ → платёж не создаётся, заказ проводится системой «без платежа» (reason zero_total);
 *  - заказ в «ошибке оплаты» → повторная попытка: заказ возвращается в «ожидает оплаты» и создаётся новый платёж.
 */
export async function startPaymentForOrder(order: Order, opts: ServiceOpts = {}): Promise<{ redirectUrl: string } | null> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const row = ordersRepo.findById(db, order.id);
  if (!row || (row.status !== 'awaiting_payment' && row.status !== 'payment_failed')) return null;

  if (row.totalKopecks === 0) {
    if (row.status === 'awaiting_payment') await orders.transition(row.id, 'paid', SYSTEM_ZERO, 'Сумма заказа 0 ₽: оплата не требуется', { db, now, secret: opts.secret });
    return null;
  }

  const pending = paymentsRepo.findPendingForOrder(db, row.id);
  if (pending?.redirectUrl) return { redirectUrl: pending.redirectUrl };

  const port = opts.port ?? getPaymentPort({ production: opts.production });
  const returnUrl = row.userId !== null ? `/order/${encodeURIComponent(row.number)}` : orderAccessPath(row.number, opts.secret);
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const created = await withTimeout(port.createPayment({ orderNumber: row.number, amountKopecks: row.totalKopecks, returnUrl }), timeoutMs);
      if (!created.paymentId || (!isSafeRelative(created.redirectUrl) && !/^https:\/\//.test(created.redirectUrl))) {
        throw new PaymentUnavailableError('Провайдер вернул некорректную ссылку на оплату');
      }
      // Ссылка на локальную страницу получает подписанный токен заказа: страницу откроет владелец или тот, у кого ссылка.
      const redirectUrl = isSafeRelative(created.redirectUrl)
        ? `${created.redirectUrl}${created.redirectUrl.includes('?') ? '&' : '?'}t=${orderAccessToken(row.number, opts.secret)}`
        : created.redirectUrl;
      if (row.status === 'payment_failed') {
        await orders.transition(row.id, 'awaiting_payment', { type: 'system', reason: 'payment_retry' }, undefined, { db, now, secret: opts.secret });
      }
      try {
        paymentsRepo.insert(db, {
          orderId: row.id,
          provider: port.name,
          amountKopecks: row.totalKopecks,
          externalId: created.paymentId,
          redirectUrl,
          returnUrl,
          now,
        });
      } catch (e) {
        // Параллельный вызов уже создал ожидающий платёж (уникальный индекс) — отдаём его.
        const existing = paymentsRepo.findPendingForOrder(db, row.id);
        if (existing?.redirectUrl) return { redirectUrl: existing.redirectUrl };
        throw e;
      }
      logRun({ kind: 'create_payment', ok: true, orderId: row.id });
      return { redirectUrl };
    } catch (e) {
      lastError = e;
      if (i < attempts) await sleep((opts.retryDelayMs ?? 200) * i);
    }
  }

  const code = lastError instanceof PaymentTimeoutError ? 'timeout' : 'unavailable';
  const message = safeMessage(lastError);
  paymentsRepo.insertError(db, {
    orderId: row.id,
    provider: port.name,
    amountKopecks: row.totalKopecks,
    externalId: `err_${randomUUID()}`,
    errorCode: code,
    errorMessage: message,
    now,
  });
  logRun({ kind: 'create_payment', ok: false, orderId: row.id, code, message });
  return null;
}

export type WebhookResult = { status: number; body: { ok: boolean; result?: string; error?: string } };
const reject = (status: number, error: string): WebhookResult => ({ status, body: { ok: false, error } });

/**
 * Обработчик webhook провайдера (его вызывает POST /api/payment/webhook и кнопки страницы тестовой оплаты).
 *  401 — подпись/форма не прошла; 400 — неизвестный платёж/заказ, несовпадение суммы или валюты;
 *  200 — принято (processed | ignored | alert | duplicate); 500 — сбой обработки (провайдер повторит).
 * Идемпотентность — по (provider, event id) в webhook_events. «Оплачен» ставится только здесь.
 */
export async function processPaymentWebhook(rawBody: string, headers: Headers, opts: ServiceOpts = {}): Promise<WebhookResult> {
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) return reject(400, 'Слишком большое тело запроса');
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const port = opts.port ?? getPaymentPort({ production: opts.production });

  const event = port.verifyWebhook(rawBody, headers);
  if (!event) return reject(401, 'Подпись не прошла проверку');

  const payment = paymentsRepo.findByExternalId(db, port.name, event.paymentId);
  const order = ordersRepo.findByNumber(db, event.orderNumber);
  if (!payment || !order || payment.orderId !== order.id) return reject(400, 'Неизвестный платёж или заказ');
  if (event.currency !== payment.currency) return reject(400, 'Валюта не совпадает с платежом');
  if (event.amountKopecks !== payment.amountKopecks || event.amountKopecks !== order.totalKopecks) return reject(400, 'Сумма не совпадает с заказом');

  const claim = webhookEventsRepo.claim(db, {
    provider: port.name,
    eventId: event.eventId,
    eventType: event.type,
    paymentExternalId: payment.externalId,
    orderId: order.id,
    now,
  });
  if (claim === 'duplicate') return { status: 200, body: { ok: true, result: 'duplicate' } };

  const finish = (outcome: WebhookOutcome, detail: string | null): WebhookResult => {
    webhookEventsRepo.finish(db, port.name, event.eventId, outcome, detail, now);
    if (outcome === 'alert') logRun({ kind: 'webhook', ok: false, orderId: order.id, code: 'alert', message: detail ?? undefined });
    return { status: 200, body: { ok: true, result: outcome } };
  };
  const actor = { type: 'system', reason: `webhook:${event.eventId}` } as const;

  try {
    if (event.type === 'payment.succeeded') {
      if (['succeeded', 'refund_pending', 'refunded'].includes(payment.status)) return finish('ignored', 'Платёж уже подтверждён');
      if (payment.status === 'pending' && order.status === 'awaiting_payment') {
        await orders.transition(order.id, 'paid', actor, undefined, { db, now, secret: opts.secret });
        paymentsRepo.transition(db, payment.id, ['pending'], 'succeeded', now);
        return finish('processed', null);
      }
      // Деньги пришли, а заказ оплатить уже нельзя (отменён, ошибка оплаты…): заказ не трогаем, оператору — алерт.
      paymentsRepo.transition(db, payment.id, ['pending', 'failed'], 'succeeded', now);
      const detail =
        order.status === 'cancelled'
          ? 'Оплата получена по отменённому заказу — нужен возврат'
          : `Оплата получена, но заказ в статусе «${order.status}» — требуется проверка и, возможно, возврат`;
      return finish('alert', detail);
    }
    // payment.failed
    if (payment.status === 'pending' && order.status === 'awaiting_payment') {
      await orders.transition(order.id, 'payment_failed', actor, undefined, { db, now, secret: opts.secret });
      paymentsRepo.transition(db, payment.id, ['pending'], 'failed', now);
      return finish('processed', null);
    }
    return finish('ignored', `Отказ не применён: платёж «${payment.status}», заказ «${order.status}»`);
  } catch (e) {
    webhookEventsRepo.finish(db, port.name, event.eventId, 'error', safeMessage(e), now);
    logRun({ kind: 'webhook', ok: false, orderId: order.id, code: 'error', message: safeMessage(e) });
    return reject(500, 'Не удалось обработать событие');
  }
}

/**
 * Возвратчик для orders.refund: резервирует платёж атомарно (succeeded → refund_pending) ДО обращения к провайдеру,
 * поэтому два параллельных клика дают один внешний возврат (второй — 409). Ключ идемпотентности уходит провайдеру.
 * Сбой провайдера возвращает платёж в succeeded (можно повторить).
 */
export async function refundOrderPayment(order: Order, ctx: { idempotencyKey: string }, opts: ServiceOpts = {}): Promise<void> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const port = opts.port ?? getPaymentPort({ production: opts.production });
  const payment = paymentsRepo.findPaidForOrder(db, order.id);
  if (!payment) throw new ConflictError('Для заказа нет подтверждённого платежа: вернуть деньги через платёжную систему нельзя');
  if (payment.provider !== port.name) throw new ConflictError('Платёж проведён другим провайдером: возврат через текущий невозможен');
  if (!paymentsRepo.transition(db, payment.id, ['succeeded'], 'refund_pending', now)) {
    throw new ConflictError('Возврат по этому платежу уже выполняется или выполнен');
  }
  const amount = payment.amountKopecks - payment.refundedKopecks;
  try {
    await withTimeout(port.refund(payment.externalId, amount, { idempotencyKey: ctx.idempotencyKey }), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (e) {
    paymentsRepo.transition(db, payment.id, ['refund_pending'], 'succeeded', now);
    logRun({ kind: 'refund', ok: false, orderId: order.id, message: safeMessage(e) });
    throw e instanceof ConflictError ? e : new ConflictError('Платёжная система не выполнила возврат. Деньги не возвращены, попробуйте позже.');
  }
  paymentsRepo.transition(db, payment.id, ['refund_pending'], 'refunded', now, { refundedKopecks: payment.amountKopecks });
  logRun({ kind: 'refund', ok: true, orderId: order.id });
}

/** Включает «онлайн (ТЕСТ)» — только вне production и только при активном тестовом провайдере. */
export function enableTestPaymentMethod(db: Db, opts: { production?: boolean; port?: PaymentPort } = {}): void {
  const production = opts.production ?? isProductionEnv();
  const port = opts.port ?? getPaymentPort({ production });
  if (production) throw new ConflictError('В production тестовая оплата недоступна');
  if (port.name !== 'test') throw new ConflictError('Тестовый платёжный провайдер не подключён');
  methodsRepo.insertOnlineTestIfMissing(db);
  methodsRepo.setPaymentEnabled(db, 'online_test', true);
}

/** В production тестовый метод всегда выключен (страховка при старте). */
export function disableTestPaymentInProduction(db: Db, production = isProductionEnv()): void {
  if (production) methodsRepo.setPaymentEnabled(db, 'online_test', false);
}
