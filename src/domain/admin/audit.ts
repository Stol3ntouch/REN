import { getDb, type Db } from '@/server/db/connection';
import { auditRepo, type ActorType, type AuditFilter, type AuditResult, type AuditRow, type AuditSearchRow } from '@/server/db/repositories/audit';
import { currentRequestInfo, hashForAudit, type RequestInfo } from './audit-context';
import { maskPii } from './mask';

export type { AuditResult };

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
  /** ok по умолчанию; denied — отказ по правам; error — операция не удалась. */
  result?: AuditResult;
  /** Сведения о запросе; по умолчанию берутся из контекста runWithRequestInfo. Пишутся только хешем. */
  request?: RequestInfo;
};

const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(maskPii(v)));
const str = (v: string | number | null | undefined): string | null => (v === undefined || v === null ? null : String(v));

/**
 * Журнал аудита (правило 12). Только добавление и чтение. Email и телефон в before/after
 * маскируются ДО записи, секреты (пароль, токен, хеш…) заменяются. Чтение журнала — за правом 'audit.read'
 * (проверяет вызывающий обработчик).
 */
export const audit = {
  record(entry: AuditEntry, opts: { db?: Db; now?: number } = {}): number {
    const req = entry.request ?? currentRequestInfo();
    return auditRepo.insert(opts.db ?? getDb(), {
      at: opts.now ?? Date.now(),
      actorId: str(entry.actorId),
      actorType: entry.actorType,
      action: entry.action,
      entity: entry.entity,
      entityId: str(entry.entityId),
      beforeJson: json(entry.before),
      afterJson: json(entry.after),
      result: entry.result ?? 'ok',
      ipHash: hashForAudit('ip', req?.ip),
      uaHash: hashForAudit('ua', req?.userAgent),
    });
  },
  list(filter: AuditFilter = {}, opts: { db?: Db } = {}): AuditRow[] {
    return auditRepo.list(opts.db ?? getDb(), filter);
  },
  /** Страница журнала и общее число записей под фильтр. */
  search(filter: AuditFilter = {}, opts: { db?: Db } = {}): { rows: AuditSearchRow[]; total: number } {
    return auditRepo.search(opts.db ?? getDb(), filter);
  },
};
