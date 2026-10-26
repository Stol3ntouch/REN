import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { integrationsAdmin, type IntegrationCard } from '@/domain/admin/integrations';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { formatRub } from '@/domain/pricing/format';
import { getPaymentPort, isProductionEnv } from '@/integrations/payment/select';
import type { PortStatus } from '@/integrations/types';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { methodsRepo, type PaymentMethodRow, type PaymentWrite } from '@/server/db/repositories/methods';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';

/**
 * Способы оплаты (C12, ADR-016).
 *  - комиссия = фиксированная часть + процент от (товары − скидка + известная доставка), округление по настройке (см. charges.ts);
 *  - ограничения min/max применяются к той же базе (без комиссии и налога);
 *  - ключи и секреты провайдера в БД и в интерфейс НЕ попадают: они только в окружении сервера (.env / настройки хоста),
 *    админка показывает лишь «задан / не задан»;
 *  - в production тестовый режим и тестовые методы запрещены; онлайн-метод без подключённого провайдера включить нельзя.
 */

type Env = Record<string, string | undefined>;
type Opts = { db?: Db; now?: number; env?: Env; production?: boolean };

/** Имена переменных окружения платёжного провайдера (значения не читаются и не отдаются). */
export const PAYMENT_SECRET_ENV = [
  { name: 'PAYMENT_API_KEY', purpose: 'Ключ API платёжного провайдера' },
  { name: 'PAYMENT_WEBHOOK_SECRET', purpose: 'Секрет подписи уведомлений провайдера' },
] as const;

/** Подходит ли способ оплаты под сумму к оплате (без комиссии и налога). null — подходит, иначе причина. */
export function paymentLimitProblem(m: Pick<PaymentMethodRow, 'name' | 'minKopecks' | 'maxKopecks'>, baseKopecks: number): string | null {
  if (m.minKopecks !== null && baseKopecks < m.minKopecks) return `Способ «${m.name}» доступен для заказов от ${formatRub(m.minKopecks)}`;
  if (m.maxKopecks !== null && baseKopecks > m.maxKopecks) return `Способ «${m.name}» доступен для заказов до ${formatRub(m.maxKopecks)}`;
  return null;
}

export type ProviderInfo = {
  /** Выбранный провайдер из PAYMENT_PROVIDER (имя, не секрет); null — не выбран. */
  provider: string | null;
  port: PortStatus;
  secrets: { name: string; purpose: string; set: boolean }[];
};

export function providerInfo(opts: { env?: Env; production?: boolean } = {}): ProviderInfo {
  const env = opts.env ?? process.env;
  const production = opts.production ?? isProductionEnv(env);
  const provider = (env.PAYMENT_PROVIDER ?? '').trim();
  return {
    provider: provider === '' ? null : provider.slice(0, 40),
    port: getPaymentPort({ production, env }).status(),
    secrets: PAYMENT_SECRET_ENV.map((s) => ({ ...s, set: (env[s.name] ?? '').trim() !== '' })),
  };
}

const money = z.number().int('Сумма в целых копейках').min(0, 'Сумма не может быть отрицательной').max(100_000_000_00, 'Слишком большая сумма');

export const paymentInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Название: не короче 2 знаков').max(120, 'Название: не длиннее 120 знаков'),
    description: z
      .string()
      .trim()
      .max(500, 'Описание: не длиннее 500 знаков')
      .nullish()
      .transform((v) => (v ? v : null)),
    enabled: z.boolean(),
    sort: z.number().int().min(0).max(9999),
    feePercentBp: z.number().int('Процент — целое число сотых долей').min(0, 'Комиссия не может быть отрицательной').max(10_000, 'Комиссия не больше 100 %'),
    feeFixedKopecks: money,
    minKopecks: money.nullable(),
    maxKopecks: money.min(1, 'Максимум: больше нуля').nullable(),
    mode: z.enum(['test', 'live'], { error: 'Режим: тестовый или рабочий' }),
  })
  .superRefine((v, ctx) => {
    if (v.minKopecks !== null && v.maxKopecks !== null && v.minKopecks > v.maxKopecks) {
      ctx.addIssue({ code: 'custom', path: ['maxKopecks'], message: 'Максимум не может быть меньше минимума' });
    }
  });

function parse(input: unknown): PaymentWrite {
  const r = paymentInputSchema.safeParse(input);
  if (!r.success) {
    const fields: Record<string, string[]> = {};
    for (const i of r.error.issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
    throw new ValidationError(r.error.issues[0]?.message ?? 'Проверьте поля формы', fields);
  }
  return r.data;
}

const snapshot = (m: PaymentMethodRow) => ({
  name: m.name,
  enabled: m.enabled,
  feePercentBp: m.feePercentBp,
  feeFixedKopecks: m.feeFixedKopecks,
  minKopecks: m.minKopecks,
  maxKopecks: m.maxKopecks,
  mode: m.mode,
});

function assertMayEnable(m: PaymentMethodRow, mode: 'test' | 'live', opts: Opts): void {
  const production = opts.production ?? isProductionEnv(opts.env ?? process.env);
  if (production && (m.testOnly || (m.kind === 'online' && mode === 'test'))) {
    throw new ConflictError('В production тестовая оплата запрещена: тестовый метод и тестовый режим включить нельзя');
  }
  if (m.kind === 'online' && getPaymentPort({ production, env: opts.env ?? process.env }).name === 'none') {
    throw new ConflictError('Онлайн-оплата не подключена: платёжный провайдер не выбран. Метод включить нельзя');
  }
}

export const paymentAdmin = {
  view(session: StaffSession | null, opts: Opts = {}): { methods: PaymentMethodRow[]; provider: ProviderInfo; connection: IntegrationCard } {
    requirePermission(session, 'payments.write');
    const db = opts.db ?? getDb();
    return {
      methods: methodsRepo.listPayment(db),
      provider: providerInfo(opts),
      connection: integrationsAdmin.card(session, 'payment', { db, now: opts.now, env: opts.env }, 'payments.write'),
    };
  },

  /** Кнопка «Проверить»: реальная проверка платёжного порта. Пока провайдеров нет — честное «не подключено». Право payments.write. */
  async check(session: StaffSession | null, opts: Opts = {}): Promise<IntegrationCard> {
    requirePermission(session, 'payments.write');
    return integrationsAdmin.check(session, 'payment', { db: opts.db, now: opts.now, env: opts.env }, 'payments.write');
  },

  /** Новый способ — только «при получении» (наличными, картой курьеру и т. п.). Онлайн-метод без провайдера не создаётся. */
  create(session: StaffSession | null, input: unknown, opts: Opts = {}): number {
    requirePermission(session, 'payments.write');
    const w = { ...parse(input), mode: 'live' as const };
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const id = methodsRepo.insertCashPayment(db, w);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'payment.create', entity: 'payment_method', entityId: id, after: snapshot(methodsRepo.findPayment(db, id)!) }, { db, now });
      return id;
    });
  },

  update(session: StaffSession | null, id: number, input: unknown, opts: Opts = {}): void {
    requirePermission(session, 'payments.write');
    const parsed = parse(input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = methodsRepo.findPayment(db, id);
      if (!before) throw new NotFoundError('Способ оплаты не найден');
      // Для «при получении» режима провайдера нет; тестовый метод остаётся тестовым.
      const mode = before.kind === 'cash_on_delivery' ? 'live' : before.testOnly ? 'test' : parsed.mode;
      if (parsed.enabled && (!before.enabled || mode !== before.mode)) assertMayEnable(before, mode, opts);
      if (!parsed.enabled && before.enabled && methodsRepo.listPayment(db, { enabledOnly: true }).filter((x) => x.id !== id).length === 0) {
        throw new ConflictError('Нельзя отключить последний способ оплаты: оформление заказов остановится');
      }
      methodsRepo.updatePayment(db, id, { ...parsed, mode });
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'payment.update', entity: 'payment_method', entityId: id, before: snapshot(before), after: snapshot(methodsRepo.findPayment(db, id)!) },
        { db, now },
      );
    });
  },

  remove(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'payments.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const m = methodsRepo.findPayment(db, id);
      if (!m) throw new NotFoundError('Способ оплаты не найден');
      if (m.kind === 'online') throw new ConflictError('Онлайн-метод удалить нельзя: отключите его');
      if (methodsRepo.countOrdersByPayment(db, id) > 0) throw new ConflictError('По этому способу уже есть заказы: удалить нельзя, отключите его');
      if (m.enabled && methodsRepo.listPayment(db, { enabledOnly: true }).filter((x) => x.id !== id).length === 0) {
        throw new ConflictError('Нельзя удалить последний способ оплаты: оформление заказов остановится');
      }
      methodsRepo.deletePayment(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'payment.delete', entity: 'payment_method', entityId: id, before: snapshot(m) }, { db, now });
    });
  },
};
