import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOnLoginHooks, login, logout, register, registerOnLoginHook, safeRedirectPath } from '@/domain/customers/auth';
import { consent } from '@/domain/customers/consent';
import { USER_SESSION_COOKIE, getSession } from '@/domain/customers/session';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { GUEST_COOKIE } from '@/server/http/owner';
import { fakeCookies, T0 } from './helpers';

const GUEST = '11111111-2222-4333-8444-555555555555';
const good = { email: 'Anna@Example.com ', password: 'long-enough-pass', consent: true };

function setup() {
  const db = createTestDb();
  const cookies = fakeCookies({ [GUEST_COOKIE]: GUEST });
  return { db, cookies, ctx: { db, cookies, ip: '10.0.0.1', now: T0 } };
}

afterEach(() => clearOnLoginHooks());

describe('register', () => {
  it('создаёт пользователя (email нормализуется), пишет согласие, открывает сессию', async () => {
    const { db, cookies, ctx } = setup();
    const { userId } = await register(good, ctx);

    expect(getSession(cookies, { db, now: T0 })).toEqual({ userId, email: 'anna@example.com' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string };
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain('long-enough-pass');

    const c = db.prepare('SELECT kind, source, user_id FROM consents').all();
    expect(c).toEqual([{ kind: 'privacy', source: 'register', user_id: userId }]);
  });

  it('пароль короче 10 символов → ошибка по полю password', async () => {
    const { ctx } = setup();
    const err = await register({ ...good, password: '123456789' }, ctx).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fields.password?.[0]).toMatch(/10/);
  });

  it('неверный email и отсутствие согласия → ошибки по полям', async () => {
    const { ctx } = setup();
    const e1 = await register({ ...good, email: 'not-an-email' }, ctx).catch((e) => e);
    expect(e1).toBeInstanceOf(ValidationError);
    expect(e1.fields.email).toBeDefined();
    const e2 = await register({ ...good, consent: false }, ctx).catch((e) => e);
    expect(e2).toBeInstanceOf(ValidationError);
    expect(e2.fields.consent).toBeDefined();
  });

  it('повторная регистрация того же email (в другом регистре) → понятный конфликт, без второй записи', async () => {
    const { db, ctx } = setup();
    await register(good, ctx);
    const err = await register({ ...good, email: 'ANNA@example.com' }, { ...ctx, cookies: fakeCookies() }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toMatch(/уже зарегистрирован/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
  });

  it('вызывает onLogin-хук с guestId из cookie и новым userId', async () => {
    const { ctx } = setup();
    const hook = vi.fn();
    registerOnLoginHook(hook);
    const { userId } = await register(good, ctx);
    expect(hook).toHaveBeenCalledWith(GUEST, userId);
  });
});

describe('login / logout', () => {
  it('верный пароль открывает сессию и зовёт onLogin(guestId, userId); сбой хука не ломает вход', async () => {
    const { db, ctx } = setup();
    const { userId } = await register(good, ctx);

    const cookies = fakeCookies({ [GUEST_COOKIE]: GUEST });
    const hook = vi.fn();
    registerOnLoginHook(() => {
      throw new Error('merge failed');
    });
    registerOnLoginHook(hook);
    const res = await login({ email: 'ANNA@example.com', password: 'long-enough-pass' }, { ...ctx, cookies });
    expect(res.userId).toBe(userId);
    expect(getSession(cookies, { db, now: T0 })?.userId).toBe(userId);
    expect(hook).toHaveBeenCalledWith(GUEST, userId);
  });

  it('вход без гостевой cookie зовёт хук с guestId=null', async () => {
    const { ctx } = setup();
    const { userId } = await register(good, ctx);
    const hook = vi.fn();
    registerOnLoginHook(hook);
    await login({ email: 'anna@example.com', password: 'long-enough-pass' }, { ...ctx, cookies: fakeCookies() });
    expect(hook).toHaveBeenCalledWith(null, userId);
  });

  it('неверный пароль и неизвестный email дают одинаковую ошибку, сессии нет', async () => {
    const { db, ctx } = setup();
    await register(good, ctx);
    const cookies = fakeCookies();
    const a = await login({ email: 'anna@example.com', password: 'wrong-password-1' }, { ...ctx, cookies }).catch((e) => e);
    const b = await login({ email: 'nobody@example.com', password: 'wrong-password-1' }, { ...ctx, cookies }).catch((e) => e);
    expect(a).toBeInstanceOf(UnauthorizedError);
    expect(b).toBeInstanceOf(UnauthorizedError);
    expect(a.message).toBe(b.message);
    expect(cookies.jar.has(USER_SESSION_COOKIE)).toBe(false);
    expect(getSession(cookies, { db, now: T0 })).toBeNull();
  });

  it('logout убирает сессию из БД и cookie', async () => {
    const { db, cookies, ctx } = setup();
    await register(good, ctx);
    logout(cookies, { db });
    expect(getSession(cookies, { db, now: T0 })).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get()).toEqual({ n: 0 });
  });
});

describe('consent.record', () => {
  it('сохраняет вид, источник, субъекта и время', () => {
    const db = createTestDb();
    const id = consent.record({ kind: 'privacy', source: 'callback', subject: '+7 900 000-00-00', guestId: GUEST }, { db, now: T0 });
    expect(db.prepare('SELECT kind, source, subject, guest_id, granted_at FROM consents WHERE id = ?').get(id)).toEqual({
      kind: 'privacy',
      source: 'callback',
      subject: '+7 900 000-00-00',
      guest_id: GUEST,
      granted_at: T0,
    });
  });
});

describe('safeRedirectPath', () => {
  it('пропускает только внутренние пути', () => {
    expect(safeRedirectPath('/account/orders')).toBe('/account/orders');
    expect(safeRedirectPath('https://evil.example')).toBe('/account');
    expect(safeRedirectPath('//evil.example')).toBe('/account');
    expect(safeRedirectPath('/\\evil.example')).toBe('/account');
    expect(safeRedirectPath(undefined)).toBe('/account');
    expect(safeRedirectPath('javascript:alert(1)', '/')).toBe('/');
  });
});
