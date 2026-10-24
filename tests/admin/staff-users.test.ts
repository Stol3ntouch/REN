import { describe, expect, it } from 'vitest';
import { staffOps } from '@/app/admin/(panel)/_lib/staff-ops';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { rolesService } from '@/domain/admin/roles';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { completeStaffLink, peekStaffLink, requestStaffPasswordReset } from '@/domain/admin/staff-reset';
import { getStaffSession } from '@/domain/admin/staff-session';
import { hashToken } from '@/domain/customers/session';
import { rolesRepo } from '@/server/db/repositories/roles';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, ForbiddenError, RateLimitError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { fakeCookies, HOUR, T0 } from '../auth/helpers';

async function setup() {
  const db = createTestDb();
  const o = { db, now: T0 };
  await createStaff({ email: 'root', password: 'root-password-123', role: 'super_admin' }, o);
  await createStaff({ email: 'boss@shop.test', password: 'boss-password-123', role: 'admin' }, o);
  await createStaff({ email: 'mgr', password: 'manager-password-1', role: 'manager' }, o);
  const login = async (id: string, password: string) => {
    const c = fakeCookies();
    await loginStaff({ email: id, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
    return { cookies: c, session: getStaffSession(c, { db, now: T0 })! };
  };
  const root = (await login('root', 'root-password-123')).session;
  const boss = (await login('boss@shop.test', 'boss-password-123')).session;
  const mgr = (await login('mgr', 'manager-password-1')).session;
  return { db, o, root, boss, mgr, login };
}
const idOf = (db: ReturnType<typeof createTestDb>, login: string) => (db.prepare('SELECT id FROM staff WHERE email = ?').get(login) as { id: number }).id;

describe('пользователи: создание', () => {
  it('с паролем: войти можно сразу; пароль не попадает в журнал; без пароля — приглашение с одноразовой ссылкой', async () => {
    const { db, o, boss } = await setup();
    const a = await staffOps.create(boss, { email: 'new1', password: 'secret-pass-12345', role: 'warehouse' }, o);
    expect(a.invite).toBeUndefined();
    const b = await staffOps.create(boss, { email: 'invitee@shop.test', role: 'service' }, { ...o, siteUrl: 'https://shop.test' });
    expect(b.invite!.url).toMatch(/^https:\/\/shop\.test\/admin\/reset\/[\w-]{40,}$/);
    expect(b.invite!.mailed).toBe(true);
    const token = b.invite!.url.split('/').pop()!;
    const stored = db.prepare('SELECT token_hash, kind FROM staff_password_resets').get() as { token_hash: string; kind: string };
    expect(stored).toEqual({ token_hash: hashToken(token), kind: 'invite' });
    expect(JSON.stringify(audit.list({}, { db }))).not.toMatch(/secret-pass-12345|reset\/[\w-]{40}/);
    // до установки пароля войти нельзя
    await expect(loginStaff({ email: 'invitee@shop.test', password: 'anything-12345' }, { db, cookies: fakeCookies(), ip: '9.9.9.9', now: T0 })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('защита от повышения привилегий: роль шире своей и super_admin назначить нельзя; сначала проверка права', async () => {
    const { db, o, boss, root, mgr } = await setup();
    await expect(staffOps.create(boss, { email: 'sa2', password: 'secret-pass-12345', role: 'super_admin' }, o)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffOps.create(root, { email: 'sa2', password: 'secret-pass-12345', role: 'super_admin' }, o)).resolves.toBeDefined();
    await expect(staffOps.create(root, { email: 'x1', password: 'secret-pass-12345', role: 'nope' }, o)).rejects.toBeInstanceOf(ValidationError);
    await expect(staffOps.create(mgr, { email: 'x2', password: 'secret-pass-12345', role: 'manager' }, o)).rejects.toBeInstanceOf(ForbiddenError);
    // пользователь с users.manage, но без roles.manage: назначает только роли не шире своих
    const lim = rolesService.create(root, { name: 'Кадровик', permissions: ['users.manage', 'orders.read'] }, o);
    await createStaff({ email: 'hr-user', password: 'hr-password-1234', role: rolesRepo.findById(db, lim.roleId)!.code }, o);
    const c = fakeCookies();
    await loginStaff({ email: 'hr-user', password: 'hr-password-1234' }, { db, cookies: c, ip: '4.4.4.4', now: T0 });
    const hr = getStaffSession(c, { db, now: T0 })!;
    expect(staffOps.assignableRoles(hr, o).map((r) => r.name)).toEqual(['Кадровик']);
    await expect(staffOps.create(hr, { email: 'x3', password: 'secret-pass-12345', role: 'manager' }, o)).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => staffOps.setRole(hr, idOf(db, 'boss@shop.test'), 'manager', o)).toThrow(ForbiddenError);
    expect(() => staffOps.setActive(hr, idOf(db, 'root'), false, o)).toThrow(ForbiddenError);
  });
});

describe('пользователи: блокировка и последний суперадмин', () => {
  it('блокировка завершает все сессии немедленно; возврат доступа разрешает вход', async () => {
    const { db, o, boss, login } = await setup();
    const worker = await login('mgr', 'manager-password-1');
    expect(getStaffSession(worker.cookies, { db, now: T0 })).not.toBeNull();
    staffOps.setActive(boss, idOf(db, 'mgr'), false, o);
    expect(getStaffSession(worker.cookies, { db, now: T0 })).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM staff_sessions WHERE staff_id = ?').get(idOf(db, 'mgr'))).toEqual({ n: 0 });
    await expect(login('mgr', 'manager-password-1')).rejects.toBeInstanceOf(UnauthorizedError);
    staffOps.setActive(boss, idOf(db, 'mgr'), true, o);
    await expect(login('mgr', 'manager-password-1')).resolves.toBeDefined();
    expect(audit.list({ entity: 'staff' }, { db }).map((r) => r.action)).toEqual(expect.arrayContaining(['staff.block', 'staff.unblock']));
  });

  it('последнего суперадмина нельзя заблокировать или понизить; при втором — можно; себя блокировать нельзя', async () => {
    const { db, o, root } = await setup();
    const second = await staffOps.create(root, { email: 'sa-two', password: 'secret-pass-12345', role: 'super_admin' }, o);
    expect(() => staffOps.setActive(root, idOf(db, 'root'), false, o)).toThrow(ConflictError); // себя
    // понижение root вторым суперадмином допустимо, пока второй активен
    const sa2 = (await (async () => {
      const c = fakeCookies();
      await loginStaff({ email: 'sa-two', password: 'secret-pass-12345' }, { db, cookies: c, ip: '5.5.5.5', now: T0 });
      return getStaffSession(c, { db, now: T0 })!;
    })()) as StaffSession;
    staffOps.setRole(sa2, idOf(db, 'root'), 'admin', o);
    expect(() => staffOps.setRole(root, second.staffId, 'manager', o)).toThrow(); // root уже не суперадмин
    expect(() => staffOps.setActive({ ...sa2 }, second.staffId, false, o)).toThrow(ConflictError);
    expect(() => staffOps.setRole(sa2, second.staffId, 'manager', o)).toThrow(ConflictError);
  });

  it('каждая операция: без сессии 401, без users.manage 403', async () => {
    const { o, mgr } = await setup();
    const calls: ((s: StaffSession | null) => unknown)[] = [
      (s) => staffOps.list(s, o),
      (s) => staffOps.search(s, { limit: 10, offset: 0 }, o),
      (s) => staffOps.get(s, 1, o),
      (s) => staffOps.setName(s, 1, 'Имя', o),
      (s) => staffOps.setRole(s, 1, 'manager', o),
      (s) => staffOps.setActive(s, 1, false, o),
      (s) => staffOps.issueResetLink(s, 1, o),
      (s) => staffOps.assignableRoles(s, o),
    ];
    for (const call of calls) {
      expect(() => call(null)).toThrow(UnauthorizedError);
      expect(() => call(mgr)).toThrow(ForbiddenError);
    }
    await expect(staffOps.create(null, { email: 'a1b', role: 'manager' }, o)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('сброс пароля', () => {
  it('ссылка одноразовая: ставит пароль, закрывает все сессии, второй раз не работает; в БД только хеш', async () => {
    const { db, o, boss, login } = await setup();
    const worker = await login('mgr', 'manager-password-1');
    const link = staffOps.issueResetLink(boss, idOf(db, 'mgr'), { ...o, siteUrl: 'https://shop.test' });
    expect(link.mailed).toBe(false); // логин не email — письмо невозможно, ссылка показана администратору
    const token = link.url.split('/').pop()!;
    expect(db.prepare('SELECT COUNT(*) AS n FROM staff_password_resets WHERE token_hash = ?').get(token)).toEqual({ n: 0 });
    expect(peekStaffLink(token, o)).toEqual({ kind: 'reset' });

    await completeStaffLink({ token, password: 'brand-new-pass-77', confirm: 'brand-new-pass-77' }, o);
    expect(getStaffSession(worker.cookies, { db, now: T0 })).toBeNull();
    await expect(login('mgr', 'brand-new-pass-77')).resolves.toBeDefined();
    await expect(login('mgr', 'manager-password-1')).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(completeStaffLink({ token, password: 'another-pass-8888' }, o)).rejects.toBeInstanceOf(ValidationError);
    expect(JSON.stringify(audit.list({}, { db }))).not.toMatch(/brand-new-pass|manager-password/);
  });

  it('ссылка живёт час, короткий пароль и разные подтверждения отвергаются, новая ссылка гасит прежнюю', async () => {
    const { db, o, boss } = await setup();
    const id = idOf(db, 'mgr');
    const first = staffOps.issueResetLink(boss, id, o).url.split('/').pop()!;
    const second = staffOps.issueResetLink(boss, id, o).url.split('/').pop()!;
    expect(peekStaffLink(first, o)).toBeNull();
    await expect(completeStaffLink({ token: second, password: 'short' }, o)).rejects.toBeInstanceOf(ValidationError);
    await expect(completeStaffLink({ token: second, password: 'long-enough-pass-1', confirm: 'different-pass-123' }, o)).rejects.toBeInstanceOf(ValidationError);
    await expect(completeStaffLink({ token: second, password: 'long-enough-pass-1' }, { db, now: T0 + HOUR + 1 })).rejects.toBeInstanceOf(ValidationError);
    expect(peekStaffLink('forged-token', o)).toBeNull();
  });

  it('заблокированному ссылка не помогает; выдать ссылку заблокированному нельзя; суперадмина сбрасывает только суперадмин', async () => {
    const { db, o, boss, root } = await setup();
    const id = idOf(db, 'mgr');
    const token = staffOps.issueResetLink(boss, id, o).url.split('/').pop()!;
    staffOps.setActive(boss, id, false, o);
    await expect(completeStaffLink({ token, password: 'long-enough-pass-1' }, o)).rejects.toBeInstanceOf(ValidationError);
    expect(() => staffOps.issueResetLink(boss, id, o)).toThrow(ConflictError);
    expect(() => staffOps.issueResetLink(boss, idOf(db, 'root'), o)).toThrow(ForbiddenError);
    expect(staffOps.issueResetLink(root, idOf(db, 'boss@shop.test'), o).mailed).toBe(true);
  });

  it('«забыли пароль»: ответ одинаков для существующего и несуществующего логина; письмо только активному с email; лимиты', async () => {
    const { db, o } = await setup();
    const ctx = { ...o, ip: '7.7.7.7', siteUrl: 'https://shop.test' };
    const known = await requestStaffPasswordReset({ login: 'BOSS@shop.test' }, ctx);
    const ghost = await requestStaffPasswordReset({ login: 'ghost@shop.test' }, ctx);
    const noMail = await requestStaffPasswordReset({ login: 'mgr' }, ctx);
    expect([known, ghost, noMail]).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    const mails = db.prepare('SELECT event, payload_json FROM mail_stub_queue').all() as { event: string; payload_json: string }[];
    expect(mails).toHaveLength(1);
    expect(JSON.parse(mails[0]!.payload_json).to).toBe('boss@shop.test');
    expect(db.prepare('SELECT COUNT(*) AS n FROM staff_password_resets').get()).toEqual({ n: 1 });
    await requestStaffPasswordReset({ login: 'boss@shop.test' }, ctx);
    await requestStaffPasswordReset({ login: 'boss@shop.test' }, ctx);
    await expect(requestStaffPasswordReset({ login: 'boss@shop.test' }, ctx)).rejects.toBeInstanceOf(RateLimitError);
  });
});
