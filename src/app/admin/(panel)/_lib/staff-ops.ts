import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { enqueueMail } from '@/domain/admin/mail-enqueue';
import { SUPER_ADMIN_CODE } from '@/domain/admin/permission-catalog';
import { hasPermission, isSuperAdmin, requirePermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { loadRolePermissions } from '@/domain/admin/role-permissions';
import { canAssign, rolesService } from '@/domain/admin/roles';
import { createStaff } from '@/domain/admin/staff';
import { INVITE_TTL_MS, RESET_TTL_MS, issueStaffLink, staffLinkUrl } from '@/domain/admin/staff-reset';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { rolesRepo, type RoleRow } from '@/server/db/repositories/roles';
import { staffRepo, type StaffRow } from '@/server/db/repositories/staff';
import { staffAdminRepo, type StaffListRow, type StaffSearch } from '@/server/db/repositories/staff-admin';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/server/http/errors';
import { enforceRateLimit } from '@/server/http/rate-limit';

type Opts = { db?: Db; now?: number; siteUrl?: string };

/** Без управления доступом админка осталась бы без хозяина: этих прав последнего владельца лишать нельзя. */
const CRITICAL: readonly Permission[] = ['users.manage', 'roles.manage'];
const EMAIL = z.email();

export type StaffLinkResult = { url: string; expiresAt: number; mailed: boolean };

const rolePermsOf = (db: Db, role: RoleRow): readonly string[] => loadRolePermissions(db, role.id, role.code);

/**
 * Защита от повышения привилегий: суперадмином управляет только суперадмин; остальных без права roles.manage
 * можно править, лишь если их права не шире собственных («чужие роли» не видны и не правятся).
 */
function assertMayManage(db: Db, session: StaffSession, target: StaffRow): void {
  if (isSuperAdmin(session)) return;
  if (target.role === SUPER_ADMIN_CODE) throw new ForbiddenError('Суперадминистратором может управлять только суперадминистратор');
  if (hasPermission(session, 'roles.manage')) return;
  const role = rolesRepo.findById(db, target.roleId);
  if (!role) return;
  const perms = rolePermsOf(db, role);
  if (!perms.every((p) => hasPermission(session, p as Permission))) throw new ForbiddenError('У этого сотрудника права шире ваших: вы не можете им управлять');
}

/** Нельзя оставить систему без суперадмина и без владельцев управления доступом. */
function assertAccessKeepers(db: Db, target: StaffRow, next: { active: boolean; roleCode: string; roleId: number } | null): void {
  if (!target.active) return;
  const nextPerms = next && next.active ? loadRolePermissions(db, next.roleId, next.roleCode) : [];
  if (target.role === SUPER_ADMIN_CODE && next?.roleCode !== SUPER_ADMIN_CODE && rolesRepo.countActiveSuperAdmins(db, target.id) < 1) {
    throw new ConflictError('Нельзя заблокировать или понизить последнего суперадминистратора');
  }
  const currentPerms = loadRolePermissions(db, target.roleId, target.role);
  for (const p of CRITICAL) {
    if (!currentPerms.includes(p) || nextPerms.includes(p)) continue;
    if (rolesRepo.countActiveHolders(db, p, target.id) < 1) {
      throw new ConflictError('Нельзя заблокировать или понизить последнего администратора: управление доступом останется без хозяина');
    }
  }
}

function mustFind(db: Db, id: number): StaffRow {
  const row = Number.isInteger(id) ? staffRepo.findById(db, id) : null;
  if (!row) throw new NotFoundError('Сотрудник не найден');
  return row;
}

function mustFindRole(db: Db, code: unknown): RoleRow {
  const role = typeof code === 'string' ? rolesRepo.findByCode(db, code) : null;
  if (!role) throw new ValidationError('Такой роли нет', { role: ['Такой роли нет'] });
  return role;
}

function mailLink(db: Db, login: string, link: { token: string; expiresAt: number }, opts: Opts): boolean {
  if (!EMAIL.safeParse(login).success) return false;
  enqueueMail('auth.password_reset', { to: login, resetUrl: staffLinkUrl(link.token, opts.siteUrl), expiresAt: link.expiresAt }, { db, now: opts.now });
  return true;
}

const nameSchema = z.string().trim().max(100, 'Имя не длиннее 100 символов');

/** Управление сотрудниками: право users.manage. Каждое изменение — в аудит; роли назначаются с защитой от повышения привилегий. */
export const staffOps = {
  list(session: StaffSession | null, opts: Opts = {}): StaffListRow[] {
    requirePermission(session, 'users.manage');
    return staffAdminRepo.list(opts.db ?? getDb());
  },

  /** Страница списка: поиск, фильтры по роли и статусу, сортировка, серверная пагинация. */
  search(session: StaffSession | null, params: StaffSearch, opts: Opts = {}): { rows: StaffListRow[]; total: number } {
    requirePermission(session, 'users.manage');
    return staffAdminRepo.search(opts.db ?? getDb(), params);
  },

  get(session: StaffSession | null, id: number, opts: Opts = {}): { staff: StaffListRow; openSessions: number; manageable: boolean } {
    requirePermission(session, 'users.manage');
    const db = opts.db ?? getDb();
    const row = mustFind(db, id);
    const staff = staffAdminRepo.list(db).find((s) => s.id === row.id)!;
    let manageable = true;
    try {
      assertMayManage(db, session, row);
    } catch {
      manageable = false;
    }
    return { staff, openSessions: staffAdminRepo.countSessions(db, id, opts.now ?? Date.now()), manageable };
  },

  /** Роли, доступные этому сотруднику для назначения. */
  assignableRoles(session: StaffSession | null, opts: Opts = {}): RoleRow[] {
    return rolesService.assignable(session, opts);
  },

  /**
   * Новый сотрудник. Пароль указан (≥10 символов) — сотрудник входит сразу; не указан — создаётся приглашение:
   * одноразовая ссылка (72 ч), по которой он сам задаёт пароль. Ссылка возвращается один раз и не пишется в журнал.
   */
  async create(
    session: StaffSession | null,
    input: { email: unknown; password?: unknown; role: unknown; name?: unknown },
    opts: Opts = {},
  ): Promise<{ staffId: number; role: string; invite?: StaffLinkResult }> {
    requirePermission(session, 'users.manage');
    const db = opts.db ?? getDb();
    enforceRateLimit(`admin-staff-create:${session.staffId}`, 30, 3600, { db, now: opts.now });
    const role = mustFindRole(db, input.role);
    if (!canAssign(db, session, role)) throw new ForbiddenError('Эту роль вы назначать не можете');
    const password = typeof input.password === 'string' && input.password !== '' ? input.password : undefined;
    const created = await createStaff(
      { email: input.email, password, role: role.code, name: typeof input.name === 'string' && input.name.trim() !== '' ? input.name : undefined },
      { db, now: opts.now, actor: { id: session.staffId, type: 'staff' } },
    );
    if (!created.invite) return { staffId: created.staffId, role: created.role };
    const login = staffRepo.findById(db, created.staffId)!.email;
    const mailed = mailLink(db, login, created.invite, opts);
    return {
      staffId: created.staffId,
      role: created.role,
      invite: { url: staffLinkUrl(created.invite.token, opts.siteUrl), expiresAt: created.invite.expiresAt, mailed },
    };
  },

  /** Имя сотрудника. Логин меняется только пересозданием (он же идентификатор входа). */
  setName(session: StaffSession | null, targetId: number, nameInput: unknown, opts: Opts = {}): void {
    requirePermission(session, 'users.manage');
    const db = opts.db ?? getDb();
    const parsed = nameSchema.safeParse(nameInput ?? '');
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Имя указано неверно', { name: [parsed.error.issues[0]?.message ?? 'Неверное имя'] });
    const name = parsed.data === '' ? null : parsed.data;
    withTransaction(db, () => {
      const target = mustFind(db, targetId);
      assertMayManage(db, session, target);
      if (target.name === name) return;
      staffAdminRepo.setName(db, targetId, name);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'staff.update', entity: 'staff', entityId: targetId, before: { name: target.name }, after: { name } }, { db, now: opts.now });
    });
  },

  setRole(session: StaffSession | null, targetId: number, roleCode: string, opts: Opts = {}): void {
    requirePermission(session, 'users.manage');
    const db = opts.db ?? getDb();
    withTransaction(db, () => {
      const target = mustFind(db, targetId);
      const next = mustFindRole(db, roleCode);
      assertMayManage(db, session, target);
      if (target.roleId === next.id) return;
      if (!canAssign(db, session, next)) throw new ForbiddenError('Эту роль вы назначать не можете');
      assertAccessKeepers(db, target, { active: true, roleCode: next.code, roleId: next.id });
      staffAdminRepo.setRoleId(db, targetId, next.id);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'staff.role_change', entity: 'staff', entityId: targetId, before: { role: target.role }, after: { role: next.code } },
        { db, now: opts.now },
      );
    });
  },

  /** Блокировка и возврат доступа. Блокировка немедленно завершает все сессии сотрудника. */
  setActive(session: StaffSession | null, targetId: number, active: boolean, opts: Opts = {}): void {
    requirePermission(session, 'users.manage');
    const db = opts.db ?? getDb();
    withTransaction(db, () => {
      const target = mustFind(db, targetId);
      assertMayManage(db, session, target);
      if (target.active === active) return;
      if (!active) {
        if (target.id === session.staffId) throw new ConflictError('Нельзя заблокировать самого себя');
        assertAccessKeepers(db, target, null);
      }
      const closedSessions = staffAdminRepo.setActive(db, targetId, active);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: active ? 'staff.unblock' : 'staff.block', entity: 'staff', entityId: targetId, before: { active: target.active }, after: { active, closedSessions } },
        { db, now: opts.now },
      );
    });
  },

  /**
   * Одноразовая ссылка сброса пароля (1 час). Показывается администратору один раз; если логин — email,
   * дополнительно уходит письмом через очередь почты. Токен в БД — хешем, в журнал не попадает.
   */
  issueResetLink(session: StaffSession | null, targetId: number, opts: Opts = {}): StaffLinkResult {
    requirePermission(session, 'users.manage');
    const db = opts.db ?? getDb();
    enforceRateLimit(`admin-staff-reset:${session.staffId}`, 20, 3600, { db, now: opts.now });
    const now = opts.now ?? Date.now();
    const { link, login } = withTransaction(db, () => {
      const target = mustFind(db, targetId);
      assertMayManage(db, session, target);
      if (!target.active) throw new ConflictError('Сотрудник заблокирован: сначала верните доступ');
      const issued = issueStaffLink(db, { staffId: target.id, kind: 'reset', createdBy: session.staffId, now, ttlMs: RESET_TTL_MS });
      return { link: issued, login: target.email };
    });
    const mailed = mailLink(db, login, link, opts);
    audit.record(
      { actorId: session.staffId, actorType: 'staff', action: 'staff.reset_link_issue', entity: 'staff', entityId: targetId, after: { kind: 'reset', expiresAt: link.expiresAt, mailed } },
      { db, now },
    );
    return { url: staffLinkUrl(link.token, opts.siteUrl), expiresAt: link.expiresAt, mailed };
  },
};

export { INVITE_TTL_MS, RESET_TTL_MS };
