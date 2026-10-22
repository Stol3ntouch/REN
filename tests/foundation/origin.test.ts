import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '@/server/http/errors';
import { assertOrigin, checkOrigin } from '@/server/http/origin';

const req = (method: string, headers: Record<string, string>) => ({ method, headers: new Headers(headers) });

describe('checkOrigin', () => {
  it('безопасные методы пропускает без Origin', () => {
    expect(checkOrigin(req('GET', { host: 'shop.test' }))).toBe(true);
    expect(checkOrigin(req('HEAD', { host: 'shop.test' }))).toBe(true);
  });

  it('POST с Origin того же хоста проходит', () => {
    expect(checkOrigin(req('POST', { host: 'shop.test', origin: 'https://shop.test' }))).toBe(true);
  });

  it('POST с чужим Origin отклоняется', () => {
    expect(checkOrigin(req('POST', { host: 'shop.test', origin: 'https://evil.test' }))).toBe(false);
  });

  it('отличие порта — чужой Origin', () => {
    expect(checkOrigin(req('POST', { host: 'localhost:3000', origin: 'http://localhost:3001' }))).toBe(false);
    expect(checkOrigin(req('POST', { host: 'localhost:3000', origin: 'http://localhost:3000' }))).toBe(true);
  });

  it('без Origin и Referer небезопасный метод отклоняется', () => {
    expect(checkOrigin(req('POST', { host: 'shop.test' }))).toBe(false);
    expect(checkOrigin(req('DELETE', { host: 'shop.test' }))).toBe(false);
  });

  it('без Origin берёт Referer', () => {
    expect(checkOrigin(req('POST', { host: 'shop.test', referer: 'https://shop.test/cart' }))).toBe(true);
    expect(checkOrigin(req('POST', { host: 'shop.test', referer: 'https://evil.test/cart' }))).toBe(false);
  });

  it('Origin: null отклоняется', () => {
    expect(checkOrigin(req('POST', { host: 'shop.test', origin: 'null' }))).toBe(false);
  });

  it('разрешённые origin из конфигурации (SITE_URL) принимаются за прокси', () => {
    const r = req('POST', { host: 'internal:3000', origin: 'https://rts.example' });
    expect(checkOrigin(r)).toBe(false);
    expect(checkOrigin(r, { allowedOrigins: ['https://rts.example'] })).toBe(true);
  });
});

describe('assertOrigin', () => {
  it('бросает ForbiddenError на чужом Origin и молчит на своём', () => {
    expect(() => assertOrigin(req('POST', { host: 'shop.test', origin: 'https://evil.test' }))).toThrow(ForbiddenError);
    expect(() => assertOrigin(req('POST', { host: 'shop.test', origin: 'https://shop.test' }))).not.toThrow();
  });
});
