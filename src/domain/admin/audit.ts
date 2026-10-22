import { getDb, type Db } from '@/server/db/connection';
import { auditRepo, type ActorType, type AuditFilter, type AuditRow } from '@/server/db/repositories/audit';
import { maskPii } from './mask';

export type AuditEntry = {
  /** id сотрудника/пользователя; null для системных событий. */
  actorId: string | number | null;
  actorType: ActorType;
  /** Например 'price.change', 'order.status', 'staff.create', 'review.moderate'. */
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
};

const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(maskPii(v)));
const str = (v: string | number | null | undefined): string | null => (v === undefined || v === null ? null : String(v));

/**
 * Журнал аудита (правило 12). Только добавление и чтение. Email и телефон в before/after
 * маскируются ДО записи. Чтение журнала — за правом 'audit.read' (проверяет вызывающий обработчик).
 */
export const audit = {
  record(entry: AuditEntry, opts: { db?: Db; now?: number } = {}): number {
    return auditRepo.insert(opts.db ?? getDb(), {
      at: opts.now ?? Date.now(),
      actorId: str(entry.actorId),
      actorType: entry.actorType,
      action: entry.action,
      entity: entry.entity,
      entityId: str(entry.entityId),
      beforeJson: json(entry.before),
      afterJson: json(entry.after),
    });
  },
  list(filter: AuditFilter = {}, opts: { db?: Db } = {}): AuditRow[] {
    return auditRepo.list(opts.db ?? getDb(), filter);
  },
};
