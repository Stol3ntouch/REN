import { audit } from '@/domain/admin/audit';
import { enqueueMail } from '@/domain/admin/mail-enqueue';
import { orders } from '@/domain/ordering/orders';
import { canTransition, isOrderStatus, STATUS_LABELS } from '@/domain/ordering/status';
import { applyImport, parseYml, planImport } from '@/importing/yml';
import { getDb, type Db } from '@/server/db/connection';
import { integrationRunsRepo, onecExportsRepo, type IntegrationRunStatus } from '@/server/db/repositories/integration-runs';
import { ordersRepo } from '@/server/db/repositories/orders';
import { hashOrderExport } from './file-stub';
import type { OneCPort, OrderExport } from './types';

/** Кто запустил: сотрудник (staffId) или система/CLI. */
export type RunActor = { staffId: number } | 'system' | 'cli';
export type OnecCtx = { db?: Db; now?: number; port: OneCPort; actor?: RunActor };
export type RunResult = { runId: number; kind: string; status: IntegrationRunStatus; counts: Record<string, number>; errors: string[] };

/** Из 1С допустимы только эти статусы: «оплачен», «ошибка оплаты» и «возврат» ставит платёжная система, не 1С. */
export const ONEC_ALLOWED_STATUSES = ['processing', 'shipped', 'ready_for_pickup', 'delivered', 'cancelled'] as const;

const actorLabel = (a: RunActor | undefined): string => (a && typeof a === 'object' ? `staff:${a.staffId}` : (a ?? 'system'));
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const staffIdOf = (a: RunActor | undefined): number | null => (a && typeof a === 'object' ? a.staffId : null);

type Body = { counts: Record<string, number>; errors: string[]; /** Сколько записей обработано успешно (для статуса partial). */ progress: number };

/** Общая обёртка: запись запуска в integration_run + аудит. Исключения внутри превращаются в статус error. */
async function logged(ctx: OnecCtx, kind: string, body: (db: Db, now: number) => Promise<Body>): Promise<RunResult> {
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();
  const runId = integrationRunsRepo.start(db, { kind, actor: actorLabel(ctx.actor), now });
  let counts: Record<string, number> = {};
  let errors: string[] = [];
  let status: Exclude<IntegrationRunStatus, 'running'> = 'ok';
  try {
    const r = await body(db, now);
    counts = r.counts;
    errors = r.errors;
    status = errors.length === 0 ? 'ok' : r.progress > 0 ? 'partial' : 'error';
  } catch (e) {
    status = 'error';
    errors = [errText(e)];
  }
  integrationRunsRepo.finish(db, runId, { status, counts, errors, now: ctx.now ?? Date.now() });
  audit.record(
    {
      actorId: staffIdOf(ctx.actor),
      actorType: staffIdOf(ctx.actor) === null ? 'system' : 'staff',
      action: kind,
      entity: 'integration_run',
      entityId: runId,
      after: { status, counts, errorCount: errors.length },
    },
    { db, now },
  );
  if (status !== 'ok') notifyFailure(kind, errors);
  return { runId, kind, status, counts, errors };
}

/** Письмо администратору о сбое обмена. Текст без ПДн: только вид запуска и первая ошибка; сбой очереди обмен не ломает. */
function notifyFailure(kind: string, errors: string[]): void {
  try {
    enqueueMail('integration.failed', { integration: '1С', message: `${kind}: ${errors[0] ?? 'ошибка'}`.slice(0, 300) });
  } catch {
    console.error('[onec] не удалось поставить в очередь письмо о сбое обмена');
  }
}

function buildExport(db: Db, number: string): OrderExport | null {
  const o = orders.getForStaff(number, { db });
  if (!o) return null;
  return {
    externalId: o.number,
    number: o.number,
    createdAt: o.createdAt,
    contact: { name: o.contact.name, email: o.contact.email, phone: o.contact.phone, address: o.contact.address ?? null, comment: o.contact.comment ?? null },
    delivery: { name: o.delivery.name, kopecks: o.delivery.priceKopecks },
    payment: { name: o.payment.name },
    items: o.items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, unitKopecks: i.unitKopecks, lineKopecks: i.lineKopecks })),
    subtotalKopecks: o.subtotalKopecks,
    discountKopecks: o.discountKopecks,
    totalKopecks: o.totalKopecks,
  };
}

/**
 * Выгрузка заказов в outbox 1С. С orderNumber — один заказ (ручной повтор); без — все готовые и ещё не выгруженные.
 * Идемпотентно по номеру заказа: повтор не создаёт второго файла, расхождение содержимого — ошибка, файл не затирается.
 */
export function runPushOrders(ctx: OnecCtx, opts: { orderNumber?: string } = {}): Promise<RunResult> {
  return logged(ctx, 'onec.push_order', async (db, now) => {
    const numbers = opts.orderNumber ? [opts.orderNumber] : onecExportsRepo.listPendingNumbers(db);
    const counts = { exported: 0, duplicates: 0, failed: 0 };
    const errors: string[] = [];
    for (const number of numbers) {
      try {
        const exp = buildExport(db, number);
        if (!exp) throw new Error('заказ не найден');
        const res = await ctx.port.pushOrder(exp);
        if (res.conflict) throw new Error('в outbox уже лежит другая версия заказа — файл не перезаписан, проверьте вручную');
        if (res.created) counts.exported++;
        else counts.duplicates++;
        const row = ordersRepo.findByNumber(db, number);
        if (row) onecExportsRepo.insert(db, { orderNumber: number, orderId: row.id, fileName: `${number}.json`, payloadHash: hashOrderExport(exp), now });
      } catch (e) {
        counts.failed++;
        errors.push(`${number}: ${errText(e)}`);
      }
    }
    return { counts, errors, progress: counts.exported + counts.duplicates };
  });
}

/** Статусы заказов из data/onec-inbox/statuses.json. Свежее локальное и недопустимое не затирается. */
export function runPullStatuses(ctx: OnecCtx, opts: { since?: Date } = {}): Promise<RunResult> {
  return logged(ctx, 'onec.pull_statuses', async (db, now) => {
    const updates = await ctx.port.pullOrderStatuses(opts.since ?? new Date(0));
    const counts = { applied: 0, unchanged: 0, skippedNewer: 0, rejected: 0 };
    const errors: string[] = [];
    for (const u of updates) {
      const row = ordersRepo.findByNumber(db, u.orderNumber);
      if (!row) {
        counts.rejected++;
        errors.push(`${u.orderNumber}: заказ не найден`);
        continue;
      }
      const to = u.status;
      if (!isOrderStatus(to) || !(ONEC_ALLOWED_STATUSES as readonly string[]).includes(to)) {
        counts.rejected++;
        errors.push(`${u.orderNumber}: статус «${u.status}» из 1С не принимается`);
        continue;
      }
      if (row.status === to) {
        counts.unchanged++;
        continue;
      }
      if (row.updatedAt > u.updatedAt) {
        counts.skippedNewer++;
        continue;
      }
      if (!canTransition(row.status, to)) {
        counts.rejected++;
        errors.push(`${u.orderNumber}: переход «${STATUS_LABELS[row.status]}» → «${STATUS_LABELS[to]}» недопустим`);
        continue;
      }
      try {
        await orders.transition(row.id, to, { type: 'system', reason: 'onec' }, 'Статус из 1С', { db, now });
        counts.applied++;
      } catch (e) {
        counts.rejected++;
        errors.push(`${u.orderNumber}: ${errText(e)}`);
      }
    }
    return { counts, errors, progress: counts.applied + counts.unchanged + counts.skippedNewer };
  });
}

/** Каталог из data/onec-inbox/*.yml: тот же разбор/план/применение, что и ручной импорт; идемпотентно. */
export function runPullCatalog(ctx: OnecCtx): Promise<RunResult> {
  return logged(ctx, 'onec.pull_catalog', async (db) => {
    const batch = await ctx.port.pullCatalog();
    if (batch.xml === null) return { counts: { files: 0 } as Record<string, number>, errors: [], progress: 0 };
    const parsed = parseYml(batch.xml);
    const plan = planImport(parsed, db, { fileName: batch.fileName });
    const report = await applyImport(plan, db, { actorId: staffIdOf(ctx.actor) });
    return {
      counts: {
        files: 1,
        created: report.products.created,
        updated: report.products.updated,
        unchanged: report.products.unchanged,
        lockedFieldsSkipped: report.products.lockedFieldsSkipped,
        importRunId: report.runId,
      },
      errors: report.errors.slice(0, 50).map((e) => e.message),
      progress: report.products.created + report.products.updated + report.products.unchanged,
    };
  });
}
