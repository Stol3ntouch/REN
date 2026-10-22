import { describe, expect, it } from 'vitest';
import { login, register } from '@/domain/customers/auth';
import { createTestDb } from '@/server/db/testing';
import { RateLimitError, UnauthorizedError } from '@/server/http/errors';
import { fakeCookies, MINUTE, T0 } from './helpers';

async function setup() {
  const db = createTestDb();
  await register({ email: 'anna@example.com', password: 'long-enough-pass', consent: true }, { db, cookies: fakeCookies(), ip: '1.1.1.1', now: T0 });
  const attempt = (password: string, over: { email?: string; ip?: string; now?: number } = {}) =>
    login(
      { email: over.email ?? 'anna@example.com', password },
      { db, cookies: fakeCookies(), ip: over.ip ?? '1.1.1.1', now: over.now ?? T0 },
    ).catch((e) => e);
  return { db, attempt };
}

describe('блокировка перебора: 5 неудач / 15 минут на email+IP', () => {
  it('после 5 неудач даже верный пароль отклоняется с RateLimitError и временем ожидания', async () => {
    const { attempt } = await setup();
    for (let i = 0; i < 5; i++) {
      expect(await attempt('bad-password-xx', { now: T0 + i * MINUTE })).toBeInstanceOf(UnauthorizedError);
    }
    const blocked = await attempt('long-enough-pass', { now: T0 + 5 * MINUTE });
    expect(blocked).toBeInstanceOf(RateLimitError);
    // самая ранняя неудача в T0 → окно кончается через 15 минут от неё, прошло 5
    expect(blocked.retryAfterSec).toBe(10 * 60);
  });

  it('4 неудачи не блокируют: верный пароль входит', async () => {
    const { attempt } = await setup();
    for (let i = 0; i < 4; i++) await attempt('bad-password-xx', { now: T0 + i * MINUTE });
    const ok = await attempt('long-enough-pass', { now: T0 + 4 * MINUTE });
    expect(ok).toEqual({ userId: expect.any(Number) });
  });

  it('через 15 минут после первой неудачи блокировка снимается', async () => {
    const { attempt } = await setup();
    for (let i = 0; i < 5; i++) await attempt('bad-password-xx', { now: T0 });
    expect(await attempt('long-enough-pass', { now: T0 + 14 * MINUTE })).toBeInstanceOf(RateLimitError);
    expect(await attempt('long-enough-pass', { now: T0 + 15 * MINUTE + 1 })).toEqual({ userId: expect.any(Number) });
  });

  it('другой IP или другой email не заблокированы', async () => {
    const { attempt } = await setup();
    for (let i = 0; i < 5; i++) await attempt('bad-password-xx', { now: T0 });
    expect(await attempt('long-enough-pass', { ip: '2.2.2.2', now: T0 + MINUTE })).toEqual({ userId: expect.any(Number) });
    expect(await attempt('whatever-pass-1', { email: 'other@example.com', now: T0 + MINUTE })).toBeInstanceOf(UnauthorizedError);
  });

  it('неизвестный email тоже считается (иначе по блокировке можно угадать наличие аккаунта)', async () => {
    const { attempt } = await setup();
    for (let i = 0; i < 5; i++) await attempt('x-password-123', { email: 'ghost@example.com', now: T0 });
    expect(await attempt('x-password-123', { email: 'ghost@example.com', now: T0 + MINUTE })).toBeInstanceOf(RateLimitError);
  });

  it('успешный вход сбрасывает счётчик', async () => {
    const { attempt } = await setup();
    for (let i = 0; i < 4; i++) await attempt('bad-password-xx', { now: T0 });
    await attempt('long-enough-pass', { now: T0 + MINUTE });
    for (let i = 0; i < 4; i++) await attempt('bad-password-xx', { now: T0 + 2 * MINUTE });
    expect(await attempt('long-enough-pass', { now: T0 + 3 * MINUTE })).toEqual({ userId: expect.any(Number) });
  });
});
