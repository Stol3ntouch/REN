import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { ADMIN_LOGIN_HREF, resolveAdminAccess } from '@/domain/admin/guard';
import { ADMIN_SESSION_COOKIE, getStaffSession, requireStaff } from '@/domain/admin/staff-session';
import { createStaff, loginStaff, logoutStaff } from '@/domain/admin/staff';
import { register } from '@/domain/customers/auth';
import { USER_SESSION_COOKIE, getSession } from '@/domain/customers/session';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, RateLimitError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { fakeCookies, HOUR, MINUTE, T0 } from '../auth/helpers';

async function setup() {
  const db = createTestDb();
  const admin = await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
  const manager = await createStaff({ email: 'Mgr@shop.test', password: 'manager-password-1', role: 'manager', name: 'Мария' }, { db, now: T0 });
  const loginAs = async (email: string, password: string) => {
    const cookies = fakeCookies();
    await loginStaff({ email, password }, { db, cookies, ip: '1.1.1.1', now: T0 });
    return cookies;
  };
  return { db, admin, manager, loginAs };
}

describe('сотрудники', () => {
  it('createStaff: scrypt-хеш, email в нижнем регистре, роль, запись в аудите; дубль → конфликт; короткий пароль → ошибка', async () => {
    const { db, manager } = await setup();
    const row = db.prepare('SELECT email, role, password_hash FROM staff WHERE id = ?').get(manager.staffId) as {
      email: string;
      role: string;
      password_hash: string;
    };
    expect(row.email).toBe('mgr@shop.test');
    expect(row.role).toBe('manager');
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);

    const log = audit.list({ action: 'staff.create' }, { db });
    expect(log).toHaveLength(2);
    expect(JSON.stringify(log)).not.toContain('manager-password');

    await expect(createStaff({ email: 'MGR@shop.test', password: 'manager-password-1', role: 'admin' }, { db })).rejects.toBeInstanceOf(ConflictError);
    await expect(createStaff({ email: 'x@shop.test', password: 'short', role: 'admin' }, { db })).rejects.toBeInstanceOf(ValidationError);
    await expect(createStaff({ email: 'x@shop.test', password: 'long-enough-pass', role: 'owner' }, { db })).rejects.toBeInstanceOf(ValidationError);
  });

  it('вход создаёт сессию в cookie rts_admin_session (HttpOnly, SameSite) и getStaffSession возвращает роль', async () => {
    const { db, admin, loginAs } = await setup();
    const cookies = await loginAs('boss@shop.test', 'admin-password-1');
    const set = cookies.sets.find((s) => s.name === ADMIN_SESSION_COOKIE)!;
    expect(set.options).toMatchObject({ httpOnly: true, path: '/' });
    expect(['lax', 'strict']).toContain(set.options!.sameSite);
    expect(getStaffSession(cookies, { db, now: T0 + MINUTE })).toEqual({ staffId: admin.staffId, email: 'boss@shop.test', name: null, role: 'admin' });
    const stored = db.prepare('SELECT token_hash FROM staff_sessions').get() as { token_hash: string };
    expect(stored.token_hash).not.toBe(set.value);
  });

  it('сессия сотрудника истекает; после выхода её нет', async () => {
    const { db, loginAs } = await setup();
    const cookies = await loginAs('mgr@shop.test', 'manager-password-1');
    expect(getStaffSession(cookies, { db, now: T0 + 13 * HOUR })).toBeNull();
    const c2 = await loginAs('mgr@shop.test', 'manager-password-1');
    logoutStaff(c2, { db });
    expect(getStaffSession(c2, { db, now: T0 })).toBeNull();
  });

  it('неверный пароль, неизвестный и отключённый сотрудник → одинаковый отказ; 5 неудач → блокировка', async () => {
    const { db } = await setup();
    db.prepare("UPDATE staff SET active = 0 WHERE email = 'mgr@shop.test'").run();
    const tryLogin = (email: string, password: string, now = T0) =>
      loginStaff({ email, password }, { db, cookies: fakeCookies(), ip: '3.3.3.3', now }).catch((e) => e);

    const wrong = await tryLogin('boss@shop.test', 'wrong-password-1');
    const ghost = await tryLogin('ghost@shop.test', 'wrong-password-1');
    const disabled = await tryLogin('mgr@shop.test', 'manager-password-1');
    for (const e of [wrong, ghost, disabled]) expect(e).toBeInstanceOf(UnauthorizedError);
    expect(new Set([wrong.message, ghost.message, disabled.message]).size).toBe(1);

    await tryLogin('boss@shop.test', 'wrong-password-2');
    await tryLogin('boss@shop.test', 'wrong-password-3');
    await tryLogin('boss@shop.test', 'wrong-password-4');
    await tryLogin('boss@shop.test', 'wrong-password-5');
    expect(await tryLogin('boss@shop.test', 'admin-password-1', T0 + MINUTE)).toBeInstanceOf(RateLimitError);
  });

  it('вход по короткому логину и по email, регистр не важен; дубль и невалидный логин отклоняются', async () => {
    const { db } = await setup();
    const { staffId } = await createStaff({ email: 'Adm', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
    expect((db.prepare('SELECT email FROM staff WHERE id = ?').get(staffId) as { email: string }).email).toBe('adm');
    const login = (id: string, password = 'admin-password-1') =>
      loginStaff({ email: id, password }, { db, cookies: fakeCookies(), ip: '4.4.4.4', now: T0 });
    expect((await login('ADM')).staffId).toBe(staffId);
    expect((await login(' adm ')).staffId).toBe(staffId);
    expect((await login('BOSS@shop.test')).staffId).toBeGreaterThan(0);

    const bad = await login('adm', 'wrong-password-1').catch((e) => e);
    const ghost = await login('nobody', 'wrong-password-1').catch((e) => e);
    expect(bad).toBeInstanceOf(UnauthorizedError);
    expect(ghost).toBeInstanceOf(UnauthorizedError);
    expect(bad.message).toBe(ghost.message);
    expect(bad.message).toBe('Неверный логин или пароль');

    await expect(createStaff({ email: 'ADM', password: 'other-password-12', role: 'manager' }, { db })).rejects.toBeInstanceOf(ConflictError);
    for (const id of ['ab', 'bad name', 'x'.repeat(33), 'ад-мин']) {
      await expect(createStaff({ email: id, password: 'other-password-12', role: 'manager' }, { db })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(createStaff({ email: 'okname', password: 'short', role: 'manager' }, { db })).rejects.toBeInstanceOf(ValidationError);
  });

  it('отключение сотрудника закрывает уже выданную сессию', async () => {
    const { db, loginAs } = await setup();
    const cookies = await loginAs('mgr@shop.test', 'manager-password-1');
    db.prepare("UPDATE staff SET active = 0 WHERE email = 'mgr@shop.test'").run();
    expect(getStaffSession(cookies, { db, now: T0 })).toBeNull();
  });
});

describe('разделение сессий покупателя и сотрудника', () => {
  it('сессия покупателя не открывает админку', async () => {
    const { db } = await setup();
    const customer = fakeCookies();
    await register({ email: 'buyer@example.com', password: 'buyer-password-1', consent: true }, { db, cookies: customer, ip: '1.1.1.1', now: T0 });

    expect(getSession(customer, { db, now: T0 })).not.toBeNull();
    expect(getStaffSession(customer, { db, now: T0 })).toBeNull();
    expect(() => requireStaff(customer, { db, now: T0 })).toThrow(UnauthorizedError);
    // даже если подложить токен покупателя в cookie админки
    const forged = fakeCookies({ [ADMIN_SESSION_COOKIE]: customer.jar.get(USER_SESSION_COOKIE)! });
    expect(getStaffSession(forged, { db, now: T0 })).toBeNull();
    expect(resolveAdminAccess(forged, null, { db, now: T0 })).toEqual({ ok: false, reason: 'unauthenticated', redirectTo: ADMIN_LOGIN_HREF });
  });

  it('сессия сотрудника не делает его покупателем', async () => {
    const { db, loginAs } = await setup();
    const staff = await loginAs('boss@shop.test', 'admin-password-1');
    expect(getSession(staff, { db, now: T0 })).toBeNull();
    const forged = fakeCookies({ [USER_SESSION_COOKIE]: staff.jar.get(ADMIN_SESSION_COOKIE)! });
    expect(getSession(forged, { db, now: T0 })).toBeNull();
  });
});

describe('доступ к страницам админки', () => {
  it('без сессии → редирект на /admin/login', async () => {
    const { db } = await setup();
    expect(ADMIN_LOGIN_HREF).toBe('/admin/login');
    expect(resolveAdminAccess(fakeCookies(), null, { db, now: T0 })).toEqual({ ok: false, reason: 'unauthenticated', redirectTo: '/admin/login' });
  });

  it('с сессией — доступ; с требуемым правом менеджеру отказ forbidden, админу доступ', async () => {
    const { db, loginAs } = await setup();
    const mgr = await loginAs('mgr@shop.test', 'manager-password-1');
    const adm = await loginAs('boss@shop.test', 'admin-password-1');
    expect(resolveAdminAccess(mgr, null, { db, now: T0 }).ok).toBe(true);
    expect(resolveAdminAccess(mgr, 'orders.read', { db, now: T0 }).ok).toBe(true);
    expect(resolveAdminAccess(mgr, 'staff.manage', { db, now: T0 })).toEqual({ ok: false, reason: 'forbidden' });
    expect(resolveAdminAccess(adm, 'staff.manage', { db, now: T0 }).ok).toBe(true);
  });
});
