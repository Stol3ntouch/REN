import { z } from 'zod';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getOnecPort, integrationsStatus, type IntegrationStatusEntry } from '@/integrations';
import { runPullCatalog, runPullStatuses, runPushOrders, type RunResult } from '@/integrations/onec/service';
import type { OneCPort } from '@/integrations/onec/types';
import { getDb, type Db } from '@/server/db/connection';
import { integrationRunsRepo, onecExportsRepo, type IntegrationRunRow } from '@/server/db/repositories/integration-runs';
import { paymentsRepo } from '@/server/db/repositories/payments';
import { webhookEventsRepo } from '@/server/db/repositories/webhook-events';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';

type Env = Record<string, string | undefined>;
type Opts = { db?: Db; now?: number; port?: OneCPort; env?: Env };

/** Переменные окружения интеграций. В админке показываются ТОЛЬКО имя, назначение и «задан / не задан». */
export const INTEGRATION_ENV: readonly { name: string; purpose: string }[] = [
  { name: 'ONEC_MODE', purpose: '1С: режим обмена' },
  { name: 'PAYMENT_PROVIDER', purpose: 'Оплата: выбранный провайдер' },
  { name: 'PAYMENT_MODE', purpose: 'Оплата: режим' },
  { name: 'PAYMENT_API_KEY', purpose: 'Оплата: ключ API провайдера' },
  { name: 'PAYMENT_WEBHOOK_SECRET', purpose: 'Оплата: секрет подписи webhook' },
  { name: 'DELIVERY_MODE', purpose: 'Доставка: режим' },
  { name: 'MAIL_HOST', purpose: 'Почта: SMTP-сервер' },
  { name: 'MAIL_PORT', purpose: 'Почта: порт SMTP' },
  { name: 'MAIL_USER', purpose: 'Почта: пользователь SMTP' },
  { name: 'MAIL_PASSWORD', purpose: 'Почта: пароль SMTP' },
  { name: 'MAIL_FROM', purpose: 'Почта: адрес отправителя' },
  { name: 'MAIL_TO', purpose: 'Почта: адрес получателя уведомлений' },
];

export type EnvStatus = { name: string; purpose: string; set: boolean };

export function envStatuses(env: Env = process.env): EnvStatus[] {
  return INTEGRATION_ENV.map((v) => ({ name: v.name, purpose: v.purpose, set: (env[v.name] ?? '').trim() !== '' }));
}

export type IntegrationsView = {
  ports: IntegrationStatusEntry[];
  onec: { pendingOrders: number; exportedOrders: number };
  runs: IntegrationRunRow[];
  paymentErrors: { id: number; orderId: number; provider: string; errorCode: string | null; errorMessage: string | null; createdAt: number }[];
  webhookAttention: { id: number; provider: string; eventId: string; outcome: string; detail: string | null; orderId: number | null; receivedAt: number }[];
  env: EnvStatus[];
};

const actionSchema = z.enum(['push_orders', 'push_order', 'pull_catalog', 'pull_statuses'], { error: 'Неизвестное действие' });
const paramsSchema = z.object({ orderNumber: z.string().regex(/^RTS-\d{1,12}$/, 'Неверный номер заказа').optional() });
export type IntegrationAction = z.infer<typeof actionSchema>;

const KIND_TO_ACTION: Record<string, IntegrationAction> = {
  'onec.push_order': 'push_orders',
  'onec.pull_catalog': 'pull_catalog',
  'onec.pull_statuses': 'pull_statuses',
};

export const integrationsOps = {
  /** Просмотр: integrations.read (admin и manager). */
  overview(session: StaffSession | null, opts: Opts = {}): IntegrationsView {
    requirePermission(session, 'integrations.read');
    const db = opts.db ?? getDb();
    const env = opts.env ?? process.env;
    return {
      ports: integrationsStatus({ env }),
      onec: { pendingOrders: onecExportsRepo.countPending(db), exportedOrders: onecExportsRepo.count(db) },
      runs: integrationRunsRepo.list(db, { limit: 30 }),
      paymentErrors: paymentsRepo.listErrors(db, { limit: 20 }).map((p) => ({
        id: p.id,
        orderId: p.orderId,
        provider: p.provider,
        errorCode: p.errorCode,
        errorMessage: p.errorMessage,
        createdAt: p.createdAt,
      })),
      webhookAttention: webhookEventsRepo.listAttention(db, { limit: 20 }).map((w) => ({
        id: w.id,
        provider: w.provider,
        eventId: w.eventId,
        outcome: w.outcome,
        detail: w.detail,
        orderId: w.orderId,
        receivedAt: w.receivedAt,
      })),
      env: envStatuses(env),
    };
  },

  /** Запуск обмена вручную: integrations.run (только admin). Все действия идемпотентны, повтор безопасен. */
  async run(session: StaffSession | null, action: IntegrationAction, params: { orderNumber?: string }, opts: Opts = {}): Promise<RunResult> {
    requirePermission(session, 'integrations.run');
    const a = actionSchema.safeParse(action);
    if (!a.success) throw new ValidationError('Неизвестное действие');
    const p = paramsSchema.safeParse(params);
    if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? 'Неверные параметры');
    const ctx = { db: opts.db, now: opts.now, port: opts.port ?? getOnecPort(), actor: { staffId: session.staffId } };
    switch (a.data) {
      case 'push_orders':
        return runPushOrders(ctx, {});
      case 'push_order':
        if (!p.data.orderNumber) throw new ValidationError('Укажите номер заказа');
        return runPushOrders(ctx, { orderNumber: p.data.orderNumber });
      case 'pull_catalog':
        return runPullCatalog(ctx);
      case 'pull_statuses':
        return runPullStatuses(ctx, {});
    }
  },

  /** Повтор прошлого запуска теми же действиями (выгрузка — всех ещё не выгруженных). Платёжные запуски не повторяются. */
  async retry(session: StaffSession | null, runId: number, opts: Opts = {}): Promise<RunResult> {
    requirePermission(session, 'integrations.run');
    const db = opts.db ?? getDb();
    const run = integrationRunsRepo.get(db, runId);
    if (!run) throw new NotFoundError('Запуск не найден');
    const action = KIND_TO_ACTION[run.kind];
    if (!action) throw new ConflictError('Этот запуск повторить нельзя: платёжные операции повторяются из карточки заказа');
    return integrationsOps.run(session, action, {}, opts);
  },
};
