import { generateToken, hashToken, sessionCookieOptions } from '@/domain/customers/session';
import { getDb, type Db } from '@/server/db/connection';
import { sessionsRepo } from '@/server/db/repositories/sessions';
import { staffRepo } from '@/server/db/repositories/staff';
import { UnauthorizedError } from '@/server/http/errors';
import type { CookieReader, CookieStore } from '@/server/http/owner';
import { loadRolePermissions } from './role-permissions';
import type { StaffSession } from './permissions';

/** Сессия сотрудника: своя cookie и своя таблица (staff_sessions), не пересекается с rts_session покупателя. */
export const ADMIN_SESSION_COOKIE = 'rts_admin_session';
export const ADMIN_SESSION_TTL_SEC = 60 * 60 * 12;
export type Opts = { db?: Db; now?: number };

export function createStaffSession(cookies: CookieStore, staffId: number, opts: Opts = {}): void {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const token = generateToken();
  sessionsRepo.deleteExpired(db, 'staff', now);
  sessionsRepo.insert(db, 'staff', { ownerId: staffId, tokenHash: hashToken(token), now, expiresAt: now + ADMIN_SESSION_TTL_SEC * 1000 });
  cookies.set(ADMIN_SESSION_COOKIE, token, sessionCookieOptions(ADMIN_SESSION_TTL_SEC, 'strict'));
}

export function destroyStaffSession(cookies: CookieStore, opts: Opts = {}): void {
  const token = cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (token) sessionsRepo.deleteByHash(opts.db ?? getDb(), 'staff', hashToken(token));
  cookies.set(ADMIN_SESSION_COOKIE, '', { ...sessionCookieOptions(0, 'strict'), maxAge: 0 });
}

/**
 * Сотрудник по cookie rts_admin_session; отключённый или с истёкшей сессией → null.
 * Права роли читаются из БД при каждом вызове: правка роли действует на открытые сессии со следующего запроса.
 */
export function getStaffSession(cookies: CookieReader, opts: Opts = {}): StaffSession | null {
  const token = cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = opts.db ?? getDb();
  const staffId = sessionsRepo.findOwnerId(db, 'staff', hashToken(token), opts.now ?? Date.now());
  if (staffId === null) return null;
  const s = staffRepo.findById(db, staffId);
  if (!s || !s.active) return null;
  return {
    staffId: s.id,
    email: s.email,
    name: s.name,
    role: s.role,
    roleId: s.roleId,
    roleName: s.roleName,
    permissions: loadRolePermissions(db, s.roleId, s.role),
  };
}

/** Для обработчиков: сессия сотрудника или UnauthorizedError (401). Права — отдельно, requirePermission. */
export function requireStaff(cookies: CookieReader, opts: Opts = {}): StaffSession {
  const session = getStaffSession(cookies, opts);
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  return session;
}
