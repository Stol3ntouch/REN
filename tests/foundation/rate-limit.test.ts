import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/server/db/testing';
import { RateLimitError } from '@/server/http/errors';
import { clientIp, enforceRateLimit, rateLimit } from '@/server/http/rate-limit';

const T0 = 1_700_000_000_000; // мс

describe('rateLimit', () => {
  it('пропускает limit запросов в окне, затем отказывает', () => {
    const db = createTestDb();
    const hit = (now: number) => rateLimit('form:1.2.3.4', 3, 60, { db, now });

    expect(hit(T0)).toMatchObject({ allowed: true, remaining: 2 });
    expect(hit(T0 + 1000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(hit(T0 + 2000)).toMatchObject({ allowed: true, remaining: 0 });
    const denied = hit(T0 + 3000);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    // окно началось в T0, закончится через 60 с; прошло 3 с → ждать 57
    expect(denied.retryAfterSec).toBe(57);
  });

  it('считает ключи независимо', () => {
    const db = createTestDb();
    rateLimit('a', 1, 60, { db, now: T0 });
    expect(rateLimit('a', 1, 60, { db, now: T0 }).allowed).toBe(false);
    expect(rateLimit('b', 1, 60, { db, now: T0 }).allowed).toBe(true);
  });

  it('открывает новое окно после истечения прежнего', () => {
    const db = createTestDb();
    rateLimit('a', 1, 60, { db, now: T0 });
    expect(rateLimit('a', 1, 60, { db, now: T0 + 59_000 }).allowed).toBe(false);
    expect(rateLimit('a', 1, 60, { db, now: T0 + 60_000 })).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('отказанные запросы не продлевают окно', () => {
    const db = createTestDb();
    rateLimit('a', 1, 60, { db, now: T0 });
    for (let i = 1; i < 30; i++) rateLimit('a', 1, 60, { db, now: T0 + i * 1000 });
    expect(rateLimit('a', 1, 60, { db, now: T0 + 60_000 }).allowed).toBe(true);
  });
});

describe('enforceRateLimit', () => {
  it('бросает RateLimitError с retryAfterSec при превышении', () => {
    const db = createTestDb();
    enforceRateLimit('login:x', 1, 60, { db, now: T0 });
    try {
      enforceRateLimit('login:x', 1, 60, { db, now: T0 + 10_000 });
      expect.unreachable('должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfterSec).toBe(50);
      expect((e as RateLimitError).status).toBe(429);
    }
  });
});

describe('clientIp', () => {
  it('за доверенным прокси берёт последний адрес X-Forwarded-For (его дописал наш прокси)', () => {
    const h = new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' });
    expect(clientIp(h, true)).toBe('203.0.113.7');
  });
  it('без доверия к прокси заголовок игнорируется', () => {
    const h = new Headers({ 'x-forwarded-for': '6.6.6.6' });
    expect(clientIp(h, false)).toBe('unknown');
  });
});
