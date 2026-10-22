import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/domain/customers/password';
import {
  USER_SESSION_COOKIE,
  createUserSession,
  destroyUserSession,
  getSession,
  hashToken,
  resolveOrCreateOwner,
  resolveOwner,
} from '@/domain/customers/session';
import { createTestDb } from '@/server/db/testing';
import { GUEST_COOKIE } from '@/server/http/owner';
import { usersRepo } from '@/server/db/repositories/users';
import { fakeCookies, HOUR, T0 } from './helpers';

describe('пароли', () => {
  it('хранится scrypt-строка с солью, не пароль; проверка верна только для того же пароля', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('correct horse batterz', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('соль случайная: один пароль даёт разные хеши', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('мусорный хеш не принимается, а не роняет проверку', async () => {
    expect(await verifyPassword('x', 'plain')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$2')).toBe(false);
  });
});

describe('сессия покупателя', () => {
  function setup() {
    const db = createTestDb();
    const userId = usersRepo.insert(db, { email: 'a@example.com', passwordHash: 'x', now: T0 });
    return { db, userId };
  }

  it('cookie rts_session: HttpOnly, SameSite=Lax; в БД только SHA-256 хеш токена', () => {
    const { db, userId } = setup();
    const c = fakeCookies();
    createUserSession(c, userId, { db, now: T0 });

    const set = c.sets.find((s) => s.name === USER_SESSION_COOKIE)!;
    expect(set.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(set.value.length).toBeGreaterThanOrEqual(40);

    const rows = db.prepare('SELECT token_hash FROM user_sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(createHash('sha256').update(set.value).digest('hex'));
    expect(rows[0]!.token_hash).not.toBe(set.value);
    expect(hashToken(set.value)).toBe(rows[0]!.token_hash);
  });

  it('Secure включается в production', () => {
    const { db, userId } = setup();
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      const c = fakeCookies();
      createUserSession(c, userId, { db, now: T0 });
      expect(c.sets[0]!.options).toMatchObject({ secure: true });
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? 'test';
    }
  });

  it('getSession возвращает пользователя, пока сессия жива, и null после срока', () => {
    const { db, userId } = setup();
    const c = fakeCookies();
    createUserSession(c, userId, { db, now: T0 });
    expect(getSession(c, { db, now: T0 + HOUR })).toEqual({ userId, email: 'a@example.com' });
    expect(getSession(c, { db, now: T0 + 40 * 24 * HOUR })).toBeNull();
  });

  it('без cookie, с чужим токеном и после выхода сессии нет', () => {
    const { db, userId } = setup();
    expect(getSession(fakeCookies(), { db, now: T0 })).toBeNull();
    expect(getSession(fakeCookies({ [USER_SESSION_COOKIE]: 'not-a-real-token' }), { db, now: T0 })).toBeNull();

    const c = fakeCookies();
    createUserSession(c, userId, { db, now: T0 });
    destroyUserSession(c, { db });
    expect(getSession(c, { db, now: T0 })).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get()).toEqual({ n: 0 });
  });
});

describe('resolveOwner', () => {
  const GUEST = '11111111-2222-4333-8444-555555555555';

  it('есть сессия → user; нет → guest по cookie; ничего → null', () => {
    const db = createTestDb();
    const userId = usersRepo.insert(db, { email: 'a@example.com', passwordHash: 'x', now: T0 });

    expect(resolveOwner(fakeCookies(), { db, now: T0 })).toBeNull();
    expect(resolveOwner(fakeCookies({ [GUEST_COOKIE]: GUEST }), { db, now: T0 })).toEqual({ kind: 'guest', guestId: GUEST });

    const c = fakeCookies({ [GUEST_COOKIE]: GUEST });
    createUserSession(c, userId, { db, now: T0 });
    expect(resolveOwner(c, { db, now: T0 })).toEqual({ kind: 'user', userId });
  });

  it('resolveOrCreateOwner создаёт гостя, если нет ни сессии, ни cookie', () => {
    const db = createTestDb();
    const c = fakeCookies();
    const owner = resolveOrCreateOwner(c, { db, now: T0 });
    expect(owner.kind).toBe('guest');
    expect(c.jar.has(GUEST_COOKIE)).toBe(true);
  });
});
