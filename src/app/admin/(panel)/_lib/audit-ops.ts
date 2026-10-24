import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { toCsv } from '@/domain/analytics';
import { getDb, type Db } from '@/server/db/connection';
import { AUDIT_RESULTS, type AuditResult, type AuditSearchRow } from '@/server/db/repositories/audit';

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_LIMIT = 5000;

export type AuditListFilter = {
  /** Объект: order, product, staff… */
  entity?: string;
  entityId?: string;
  /** Пользователь (id сотрудника). */
  actorId?: string;
  /** Точное действие. */
  action?: string;
  /** Тип действия по началу названия: «staff.» — всё про сотрудников. */
  actionPrefix?: string;
  result?: string;
  /** Период, unix-мс: from включительно, to исключительно. */
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
};

const cleanResult = (v: string | undefined): AuditResult | undefined => (AUDIT_RESULTS.includes(v as AuditResult) ? (v as AuditResult) : undefined);
const nonEmpty = (v: string | undefined, max: number): string | undefined => {
  const t = v?.trim().slice(0, max);
  return t ? t : undefined;
};

function toRepoFilter(f: AuditListFilter) {
  return {
    entity: nonEmpty(f.entity, 60),
    entityId: nonEmpty(f.entityId, 60),
    actorId: nonEmpty(f.actorId, 20),
    action: nonEmpty(f.action, 80),
    actionPrefix: nonEmpty(f.actionPrefix, 80),
    result: cleanResult(f.result),
    from: Number.isFinite(f.from) ? f.from : undefined,
    to: Number.isFinite(f.to) ? f.to : undefined,
  };
}

const fmtMsk = (ms: number): string => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Moscow' }).format(new Date(ms));
const compact = (v: unknown): string => (v === undefined ? '' : JSON.stringify(v));

export const auditOps = {
  /** Журнал: право audit.read. Серверная пагинация с общим числом записей под фильтр. */
  list(
    session: StaffSession | null,
    f: AuditListFilter,
    opts: { db?: Db } = {},
  ): { rows: AuditSearchRow[]; total: number; page: number; pageSize: number; hasNext: boolean } {
    requirePermission(session, 'audit.read');
    const pageSize = Math.min(Math.max(f.pageSize ?? AUDIT_PAGE_SIZE, 1), 200);
    const page = Math.max(f.page ?? 1, 1);
    const { rows, total } = audit.search({ ...toRepoFilter(f), limit: pageSize, offset: (page - 1) * pageSize }, { db: opts.db ?? getDb() });
    return { rows, total, page, pageSize, hasNext: page * pageSize < total };
  },

  /** Отфильтрованный журнал в CSV (до 5000 записей, новые сверху). Тоже audit.read. */
  exportCsv(session: StaffSession | null, f: AuditListFilter, opts: { db?: Db } = {}): { csv: string; rows: number; truncated: boolean } {
    requirePermission(session, 'audit.read');
    const { rows, total } = audit.search({ ...toRepoFilter(f), limit: AUDIT_EXPORT_LIMIT, offset: 0 }, { db: opts.db ?? getDb() });
    const csv = toCsv(
      ['Время (МСК)', 'Пользователь', 'Тип', 'Действие', 'Объект', 'ID объекта', 'Результат', 'IP (хеш)', 'Было', 'Стало'],
      rows.map((r) => [fmtMsk(r.at), r.actorLabel ?? r.actorId ?? '', r.actorType, r.action, r.entity, r.entityId ?? '', r.result, r.ipHash ?? '', compact(r.before), compact(r.after)]),
    );
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'audit.export', entity: 'audit_log', after: { rows: rows.length } }, { db: opts.db });
    return { csv, rows: rows.length, truncated: total > rows.length };
  },
};
