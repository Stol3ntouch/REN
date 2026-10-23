import { describe, expect, it } from 'vitest';
import { loginStaff, createStaff } from '@/domain/admin/staff';
import { login, register, requestPasswordReset } from '@/domain/customers/auth';
import { submitCallback } from '@/domain/requests/service';
import { createTestDb } from '@/server/db/testing';
import { RateLimitError, UnauthorizedError } from '@/server/http/errors';
import { clientIp, rateLimitByIp } from '@/server/http/rate-limit';
import { fakeCookies, T0 } from '../auth/helpers';

describe('IP не определён (TRUST_PROXY=false): чужие входы не блокируются общим бакетом', () => {
  it('clientIp без доверенного прокси даёт unknown', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '9.9.9.9' }), false)).toBe('unknown');
  });

  it('6 неудачных входов покупателя с ip=unknown не запрещают вход с верным паролем', async () => {
    const db = createTestDb();
    const ctx = (over = {}) => ({ db, cookies: fakeCookies(), ip: 'unknown', now: T0, ...over });
    await register({ email: 'anna@example.com', password: 'long-enough-pass', consent: true }, ctx());
    for (let i = 0; i < 6; i++) {
      const e = await login({ email: 'anna@example.com', password: 'bad-password-xx' }, ctx()).catch((x) => x);
      expect(e).toBeInstanceOf(UnauthorizedError);
    }
    // чужой человек с другим логином тоже не заблокирован
    const other = await login({ email: 'bob@example.com', password: 'bad-password-xx' }, ctx()).catch((x) => x);
    expect(other).toBeInstanceOf(UnauthorizedError);
    expect(await login({ email: 'anna@example.com', password: 'long-enough-pass' }, ctx())).toEqual({ userId: expect.any(Number) });
  });

  it('6 неудачных входов сотрудника с ip=unknown не запрещают вход с верным паролем', async () => {
    const db = createTestDb();
    await createStaff({ email: 'boss', password: 'long-enough-pass', role: 'admin' }, { db, now: T0 });
    const ctx = () => ({ db, cookies: fakeCookies(), ip: 'unknown', now: T0 });
    for (let i = 0; i < 6; i++) {
      expect(await loginStaff({ email: 'boss', password: 'bad-password-xx' }, ctx()).catch((x) => x)).toBeInstanceOf(UnauthorizedError);
    }
    expect(await loginStaff({ email: 'boss', password: 'long-enough-pass' }, ctx())).toEqual({ staffId: expect.any(Number) });
  });

  it('при ip=unknown перебор одного логина всё же упирается в мягкий лимит по логину', async () => {
    const db = createTestDb();
    await register({ email: 'anna@example.com', password: 'long-enough-pass', consent: true }, { db, cookies: fakeCookies(), ip: 'unknown', now: T0 });
    let last: unknown;
    for (let i = 0; i < 25; i++) {
      last = await login({ email: 'anna@example.com', password: 'bad-password-xx' }, { db, cookies: fakeCookies(), ip: 'unknown', now: T0 }).catch((x) => x);
    }
    expect(last).toBeInstanceOf(RateLimitError);
  });

  it('общие лимиты форм и сброса пароля при ip=unknown не применяются', async () => {
    const db = createTestDb();
    for (let i = 0; i < 12; i++) {
      await requestPasswordReset({ email: `u${i}@example.com` }, { db, ip: 'unknown', now: T0 });
    }
    for (let i = 0; i < 12; i++) {
      await submitCallback({ name: 'Анна', phone: '+7 916 655-06-06', consent: true }, { db, ip: 'unknown', now: T0 });
    }
    expect(rateLimitByIp('x', 'unknown', 1, 60, { db, now: T0 }).allowed).toBe(true);
    expect(rateLimitByIp('x', 'unknown', 1, 60, { db, now: T0 }).allowed).toBe(true);
  });

  it('при известном IP лимиты работают как раньше', async () => {
    const db = createTestDb();
    expect(rateLimitByIp('x', '1.1.1.1', 1, 60, { db, now: T0 }).allowed).toBe(true);
    expect(rateLimitByIp('x', '1.1.1.1', 1, 60, { db, now: T0 }).allowed).toBe(false);
  });
});

describe('HTTP-обработчик форм без доверенного прокси', () => {
  it('11 заявок подряд без определимого IP не упираются в общий лимит', async () => {
    const { handleFormRequest } = await import('@/domain/requests/http');
    const db = createTestDb();
    const send = () =>
      handleFormRequest(
        'callback',
        new Request('https://shop.test/api/forms/callback', {
          method: 'POST',
          headers: { origin: 'https://shop.test', host: 'shop.test', 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Анна', phone: '+7 900 000-11-22', consent: true, website: '' }),
        }),
        { db, now: T0, trustProxy: false },
      );
    for (let i = 0; i < 11; i++) expect((await send()).status).toBe(201);
  });
});
