import { describe, expect, it } from 'vitest';
import { login, register, requestPasswordReset, resetPassword } from '@/domain/customers/auth';
import { getSession } from '@/domain/customers/session';
import { createTestDb } from '@/server/db/testing';
import { UnauthorizedError, ValidationError } from '@/server/http/errors';
import { fakeCookies, HOUR, MINUTE, T0 } from './helpers';

const SITE = 'https://shop.test';

async function setup() {
  const db = createTestDb();
  const cookies = fakeCookies();
  await register({ email: 'anna@example.com', password: 'old-password-123', consent: true }, { db, cookies, ip: '1.1.1.1', now: T0 });
  const request = (email: string, now = T0, ip = '1.1.1.1') => requestPasswordReset({ email }, { db, ip, now, siteUrl: SITE });
  const mails = () =>
    (db.prepare('SELECT event, payload_json FROM mail_stub_queue ORDER BY id').all() as { event: string; payload_json: string }[]).map((r) => ({
      event: r.event,
      payload: JSON.parse(r.payload_json) as { to: string; resetUrl: string },
    }));
  const tokenOf = (i = 0) => mails()[i]!.payload.resetUrl.split('/').pop()!;
  return { db, cookies, request, mails, tokenOf };
}

describe('сброс пароля', () => {
  it('ответ одинаков для существующего и несуществующего email; письмо ставится только для существующего', async () => {
    const { request, mails } = await setup();
    const a = await request('anna@example.com');
    const b = await request('ghost@example.com');
    expect(a).toEqual(b);
    expect(mails()).toHaveLength(1);
    expect(mails()[0]!.event).toBe('auth.password_reset');
    expect(mails()[0]!.payload.to).toBe('anna@example.com');
    expect(mails()[0]!.payload.resetUrl.startsWith(`${SITE}/account/reset/`)).toBe(true);
  });

  it('в БД лежит только хеш токена', async () => {
    const { db, request, tokenOf } = await setup();
    await request('anna@example.com');
    const token = tokenOf();
    const rows = db.prepare('SELECT token_hash FROM password_resets').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('по ссылке задаётся новый пароль: старый перестаёт работать, новый работает, старые сессии закрыты', async () => {
    const { db, cookies, request, tokenOf } = await setup();
    await request('anna@example.com', T0);
    await resetPassword({ token: tokenOf(), password: 'brand-new-password' }, { db, now: T0 + 5 * MINUTE });

    expect(getSession(cookies, { db, now: T0 + 6 * MINUTE })).toBeNull();
    const fresh = { db, cookies: fakeCookies(), ip: '1.1.1.1', now: T0 + 7 * MINUTE };
    expect(await login({ email: 'anna@example.com', password: 'old-password-123' }, fresh).catch((e) => e)).toBeInstanceOf(UnauthorizedError);
    expect(await login({ email: 'anna@example.com', password: 'brand-new-password' }, fresh)).toEqual({ userId: expect.any(Number) });
  });

  it('ссылка одноразовая: повторное использование отклоняется', async () => {
    const { db, request, tokenOf } = await setup();
    await request('anna@example.com', T0);
    const token = tokenOf();
    await resetPassword({ token, password: 'brand-new-password' }, { db, now: T0 + MINUTE });
    const err = await resetPassword({ token, password: 'another-password-1' }, { db, now: T0 + 2 * MINUTE }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/недействительна|устарела/);
  });

  it('живёт ровно 1 час: на 59:59 работает, позже — отклоняется', async () => {
    const a = await setup();
    await a.request('anna@example.com', T0);
    await expect(resetPassword({ token: a.tokenOf(), password: 'brand-new-password' }, { db: a.db, now: T0 + HOUR - 1000 })).resolves.toBeUndefined();

    const b = await setup();
    await b.request('anna@example.com', T0);
    const err = await resetPassword({ token: b.tokenOf(), password: 'brand-new-password' }, { db: b.db, now: T0 + HOUR + 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
  });

  it('новый запрос отменяет предыдущую ссылку; мусорный токен и короткий пароль отклоняются', async () => {
    const { db, request, tokenOf } = await setup();
    await request('anna@example.com', T0);
    await request('anna@example.com', T0 + MINUTE);
    const first = await resetPassword({ token: tokenOf(0), password: 'brand-new-password' }, { db, now: T0 + 2 * MINUTE }).catch((e) => e);
    expect(first).toBeInstanceOf(ValidationError);

    const junk = await resetPassword({ token: 'junk', password: 'brand-new-password' }, { db, now: T0 }).catch((e) => e);
    expect(junk).toBeInstanceOf(ValidationError);

    const short = await resetPassword({ token: tokenOf(1), password: 'short' }, { db, now: T0 + 2 * MINUTE }).catch((e) => e);
    expect(short).toBeInstanceOf(ValidationError);
    expect(short.fields.password).toBeDefined();
    // короткий пароль не сжёг ссылку
    await expect(resetPassword({ token: tokenOf(1), password: 'brand-new-password' }, { db, now: T0 + 3 * MINUTE })).resolves.toBeUndefined();
  });
});
