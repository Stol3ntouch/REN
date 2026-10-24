import { randomBytes } from 'node:crypto';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { rolesRepo, type RoleListRow, type RoleRow } from '@/server/db/repositories/roles';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/server/http/errors';
import { audit } from './audit';
import { ALL_PERMISSIONS, BASELINE_PERMISSIONS, EDITABLE_PERMISSIONS, SUPER_ADMIN_CODE, SYSTEM_ROLES, isPermission, type Permission } from './permission-catalog';
import { hasPermission, isSuperAdmin, requirePermission, type StaffSession } from './permissions';
import { loadRolePermissions } from './role-permissions';

type Opts = { db?: Db; now?: number };

/** Права, без владельца которых админка остаётся без управления: последнего держателя лишать нельзя. */
const CRITICAL: readonly Permission[] = ['users.manage', 'roles.manage'];

export const ROLE_NAME_MIN = 2;
export const ROLE_NAME_MAX = 60;

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (name.length < ROLE_NAME_MIN || name.length > ROLE_NAME_MAX) {
    throw new ValidationError(`Название роли: от ${ROLE_NAME_MIN} до ${ROLE_NAME_MAX} символов`, { name: ['Название роли указано неверно'] });
  }
  return name;
}

function assertNameFree(db: Db, name: string, exceptId: number | null): void {
  const lower = name.toLocaleLowerCase('ru');
  const clash = rolesRepo.list(db).find((r) => r.id !== exceptId && r.name.toLocaleLowerCase('ru') === lower);
  if (clash) throw new ConflictError('Роль с таким названием уже есть');
}

function cleanPermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) throw new ValidationError('Набор прав указан неверно');
  const set = new Set<Permission>();
  for (const p of input) {
    if (!isPermission(p)) throw new ValidationError('Неизвестное право в наборе', { permissions: ['Неизвестное право'] });
    if (!BASELINE_PERMISSIONS.includes(p)) set.add(p);
  }
  return EDITABLE_PERMISSIONS.filter((p) => set.has(p));
}

function mustFind(db: Db, id: number): RoleRow {
  const role = Number.isInteger(id) ? rolesRepo.findById(db, id) : null;
  if (!role) throw new NotFoundError('Роль не найдена');
  return role;
}

/** Права, хранящиеся в БД (без базовых), для сравнения и аудита. */
const storedPermissions = (db: Db, role: RoleRow): Permission[] =>
  role.code === SUPER_ADMIN_CODE ? [...EDITABLE_PERMISSIONS] : loadRolePermissions(db, role.id, role.code).filter((p) => !BASELINE_PERMISSIONS.includes(p));

/** Нельзя выдавать то, чего нет у самого выдающего (повышение привилегий через роли). */
function assertMayGrant(session: StaffSession, granted: readonly Permission[]): void {
  const missing = granted.filter((p) => !hasPermission(session, p));
  if (missing.length > 0) throw new ForbiddenError('Нельзя выдавать права, которых нет у вас самих');
}

/** После правки набора у роли останется хотя бы один активный владелец критичных прав. */
function assertCriticalHolderRemains(db: Db, role: RoleRow, next: readonly Permission[]): void {
  if (role.code === SUPER_ADMIN_CODE) return;
  const current = new Set(rolesRepo.permissions(db, role.id));
  for (const p of CRITICAL) {
    if (!current.has(p) || next.includes(p)) continue;
    if (rolesRepo.countActiveStaffOfRole(db, role.id) === 0) continue;
    const others = rolesRepo.countActiveHolders(db, p) - rolesRepo.countActiveStaffOfRole(db, role.id);
    if (others < 1) throw new ConflictError('Нельзя снять право у единственных, кто им владеет: управление доступом останется без хозяина');
  }
}

export const rolesService = {
  /**
   * Сид системных ролей. Идемпотентен: отсутствующая роль создаётся с правами по умолчанию, у существующей
   * правки администратора в role_permissions НЕ затираются. super_admin прав в таблице не хранит.
   */
  ensureSystemRoles(opts: Opts = {}): { created: string[] } {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const created: string[] = [];
    withTransaction(db, () => {
      for (const seed of SYSTEM_ROLES) {
        if (rolesRepo.findByCode(db, seed.code)) continue;
        const id = rolesRepo.insert(db, { code: seed.code, name: seed.name, isSystem: true, now });
        if (seed.code !== SUPER_ADMIN_CODE) rolesRepo.addPermissions(db, id, seed.permissions);
        created.push(seed.code);
      }
    });
    return { created };
  },

  list(session: StaffSession | null, opts: Opts = {}): RoleListRow[] {
    requirePermission(session, 'roles.manage');
    return rolesRepo.list(opts.db ?? getDb());
  },

  /** Роль и её права. super_admin показывается со всеми правами (неизменяемо). */
  get(session: StaffSession | null, id: number, opts: Opts = {}): { role: RoleRow; permissions: Permission[]; staffCount: number; locked: boolean } {
    requirePermission(session, 'roles.manage');
    const db = opts.db ?? getDb();
    const role = mustFind(db, id);
    return { role, permissions: storedPermissions(db, role), staffCount: rolesRepo.countStaff(db, id), locked: role.code === SUPER_ADMIN_CODE };
  },

  /**
   * Роли, которые сотрудник с правом users.manage вправе назначать:
   * суперадмин — любые; roles.manage — любые, кроме суперадминистратора; иначе только роли с правами не шире его собственных.
   */
  assignable(session: StaffSession | null, opts: Opts = {}): RoleRow[] {
    requirePermission(session, 'users.manage');
    const db = opts.db ?? getDb();
    return rolesRepo.list(db).filter((r) => canAssign(db, session, r));
  },

  create(session: StaffSession | null, input: { name: unknown; permissions?: unknown }, opts: Opts = {}): { roleId: number; code: string } {
    requirePermission(session, 'roles.manage');
    const db = opts.db ?? getDb();
    const name = cleanName(input.name);
    const permissions = input.permissions === undefined ? [] : cleanPermissions(input.permissions);
    assertMayGrant(session, permissions);
    return withTransaction(db, () => {
      assertNameFree(db, name, null);
      const code = `custom_${randomBytes(4).toString('hex')}`;
      const roleId = rolesRepo.insert(db, { code, name, isSystem: false, now: opts.now ?? Date.now() });
      rolesRepo.replacePermissions(db, roleId, permissions);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'role.create', entity: 'role', entityId: roleId, after: { name, code, permissions } }, { db, now: opts.now });
      return { roleId, code };
    });
  },

  rename(session: StaffSession | null, id: number, nameInput: unknown, opts: Opts = {}): void {
    requirePermission(session, 'roles.manage');
    const db = opts.db ?? getDb();
    const name = cleanName(nameInput);
    withTransaction(db, () => {
      const role = mustFind(db, id);
      if (role.code === SUPER_ADMIN_CODE) throw new ConflictError('Роль суперадминистратора изменить нельзя');
      if (role.name === name) return;
      assertNameFree(db, name, id);
      rolesRepo.rename(db, id, name);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'role.rename', entity: 'role', entityId: id, before: { name: role.name }, after: { name } }, { db, now: opts.now });
    });
  },

  duplicate(session: StaffSession | null, id: number, nameInput: unknown, opts: Opts = {}): { roleId: number; code: string } {
    requirePermission(session, 'roles.manage');
    const db = opts.db ?? getDb();
    const name = cleanName(nameInput);
    return withTransaction(db, () => {
      const source = mustFind(db, id);
      if (source.code === SUPER_ADMIN_CODE) throw new ConflictError('Роль суперадминистратора копировать нельзя');
      const permissions = storedPermissions(db, source);
      assertMayGrant(session, permissions);
      assertNameFree(db, name, null);
      const code = `custom_${randomBytes(4).toString('hex')}`;
      const roleId = rolesRepo.insert(db, { code, name, isSystem: false, now: opts.now ?? Date.now() });
      rolesRepo.replacePermissions(db, roleId, permissions);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'role.duplicate', entity: 'role', entityId: roleId, after: { name, code, copiedFrom: source.code, permissions } },
        { db, now: opts.now },
      );
      return { roleId, code };
    });
  },

  remove(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'roles.manage');
    const db = opts.db ?? getDb();
    withTransaction(db, () => {
      const role = mustFind(db, id);
      if (role.isSystem) throw new ConflictError('Системную роль удалить нельзя');
      const staff = rolesRepo.countStaff(db, id);
      if (staff > 0) throw new ConflictError(`Роль назначена сотрудникам (${staff}). Сначала переназначьте их`);
      const permissions = rolesRepo.permissions(db, id);
      rolesRepo.delete(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'role.delete', entity: 'role', entityId: id, before: { name: role.name, code: role.code, permissions } }, { db, now: opts.now });
    });
  },

  /** Матрица флажков: заменяет набор прав роли. Выдавать можно только то, что есть у самого правящего. */
  setPermissions(session: StaffSession | null, id: number, input: unknown, opts: Opts = {}): { added: Permission[]; removed: Permission[] } {
    requirePermission(session, 'roles.manage');
    const db = opts.db ?? getDb();
    const next = cleanPermissions(input);
    return withTransaction(db, () => {
      const role = mustFind(db, id);
      if (role.code === SUPER_ADMIN_CODE) throw new ConflictError('Права суперадминистратора изменить нельзя: у него всегда все права');
      const before = storedPermissions(db, role);
      const added = next.filter((p) => !before.includes(p));
      const removed = before.filter((p) => !next.includes(p));
      if (added.length === 0 && removed.length === 0) return { added, removed };
      assertMayGrant(session, added);
      assertCriticalHolderRemains(db, role, next);
      rolesRepo.replacePermissions(db, id, next);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'role.permissions_change', entity: 'role', entityId: id, before: { code: role.code, permissions: before }, after: { code: role.code, permissions: next, added, removed } },
        { db, now: opts.now },
      );
      return { added, removed };
    });
  },
};

/** Может ли сотрудник назначить эту роль (без проверки самого права users.manage). */
export function canAssign(db: Db, session: StaffSession, role: RoleRow): boolean {
  if (isSuperAdmin(session)) return true;
  if (role.code === SUPER_ADMIN_CODE) return false;
  if (hasPermission(session, 'roles.manage')) return true;
  return storedPermissions(db, role).every((p) => hasPermission(session, p));
}

/** Все ключи прав: для проверки, что сид и миграция не разошлись. */
export const KNOWN_PERMISSION_KEYS: readonly string[] = ALL_PERMISSIONS;
