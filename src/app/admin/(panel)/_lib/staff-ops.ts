import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { createStaff } from '@/domain/admin/staff';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { staffRepo, type StaffRole } from '@/server/db/repositories/staff';
import { staffAdminRepo, type StaffListRow } from '@/server/db/repositories/staff-admin';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

const roleSchema = z.enum(['admin', 'manager'], { error: 'Роль: admin или manager' });
const parseRole = (v: unknown): StaffRole => {
  const r = roleSchema.safeParse(v);
  if (!r.success) throw new ValidationError('Роль: администратор или менеджер', { role: ['Неверная роль'] });
  return r.data;
};

/** Управление сотрудниками: только staff.manage (admin). Каждое изменение — в аудит. */
export const staffOps = {
  list(session: StaffSession | null, opts: Opts = {}): StaffListRow[] {
    requirePermission(session, 'staff.manage');
    return staffAdminRepo.list(opts.db ?? getDb());
  },

  async create(session: StaffSession | null, input: unknown, opts: Opts = {}): Promise<{ staffId: number; role: StaffRole }> {
    requirePermission(session, 'staff.manage');
    return createStaff(input, { db: opts.db, now: opts.now, actor: { id: session.staffId, type: 'staff' } });
  },

  setRole(session: StaffSession | null, targetId: number, role: StaffRole, opts: Opts = {}): void {
    requirePermission(session, 'staff.manage');
    const next = parseRole(role);
    const db = opts.db ?? getDb();
    withTransaction(db, () => {
      const target = staffRepo.findById(db, targetId);
      if (!target) throw new NotFoundError('Сотрудник не найден');
      if (target.role === next) return;
      if (target.role === 'admin' && target.active && staffAdminRepo.countActiveAdmins(db) <= 1) {
        throw new ConflictError('Нельзя снять права у последнего администратора');
      }
      staffAdminRepo.setRole(db, targetId, next);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'staff.role_change', entity: 'staff', entityId: targetId, before: { role: target.role }, after: { role: next } },
        { db, now: opts.now },
      );
    });
  },

  setActive(session: StaffSession | null, targetId: number, active: boolean, opts: Opts = {}): void {
    requirePermission(session, 'staff.manage');
    const db = opts.db ?? getDb();
    withTransaction(db, () => {
      const target = staffRepo.findById(db, targetId);
      if (!target) throw new NotFoundError('Сотрудник не найден');
      if (target.active === active) return;
      if (!active && target.id === session.staffId) throw new ConflictError('Нельзя заблокировать самого себя');
      if (!active && target.role === 'admin' && staffAdminRepo.countActiveAdmins(db) <= 1) {
        throw new ConflictError('Нельзя заблокировать последнего администратора');
      }
      staffAdminRepo.setActive(db, targetId, active);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: active ? 'staff.unblock' : 'staff.block', entity: 'staff', entityId: targetId, before: { active: target.active }, after: { active } },
        { db, now: opts.now },
      );
    });
  },
};
