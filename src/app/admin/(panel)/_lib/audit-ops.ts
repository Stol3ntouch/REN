import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, type Db } from '@/server/db/connection';
import type { AuditRow } from '@/server/db/repositories/audit';

export const AUDIT_PAGE_SIZE = 50;
export type AuditListFilter = { entity?: string; action?: string; actorId?: string; page?: number; pageSize?: number };

export const auditOps = {
  /** Журнал: право audit.read (admin). Постранично: берём на одну запись больше, чтобы узнать, есть ли следующая страница. */
  list(session: StaffSession | null, f: AuditListFilter, opts: { db?: Db } = {}): { rows: AuditRow[]; page: number; pageSize: number; hasNext: boolean } {
    requirePermission(session, 'audit.read');
    const pageSize = Math.min(Math.max(f.pageSize ?? AUDIT_PAGE_SIZE, 1), 200);
    const page = Math.max(f.page ?? 1, 1);
    const rows = audit.list(
      { entity: f.entity || undefined, action: f.action || undefined, actorId: f.actorId || undefined, limit: pageSize + 1, offset: (page - 1) * pageSize },
      { db: opts.db ?? getDb() },
    );
    return { rows: rows.slice(0, pageSize), page, pageSize, hasNext: rows.length > pageSize };
  },
};
