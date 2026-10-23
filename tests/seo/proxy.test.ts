import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from '@/proxy';

const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

afterEach(() => vi.unstubAllEnvs());

describe('proxy в production', () => {
  it('http по x-forwarded-proto → 301 на https и HSTS', () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('SITE_URL', '');
    const res = proxy(req('http://shop.example.ru/catalog/trimmery?page=2', { 'x-forwarded-proto': 'http' }));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://shop.example.ru/catalog/trimmery?page=2');
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=/);
  });

  it('при SITE_URL редирект идёт на его хост, а не на подставленный Host', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SITE_URL', 'https://shop.example.ru');
    const res = proxy(req('http://evil.test/cart', { 'x-forwarded-proto': 'http', host: 'evil.test' }));
    expect(res.headers.get('location')).toBe('https://shop.example.ru/cart');
  });

  it('https пропускается: HSTS, CSP с nonce, без редиректа', () => {
    vi.stubEnv('APP_ENV', 'production');
    const res = proxy(req('https://shop.example.ru/', { 'x-forwarded-proto': 'https' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=/);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
  });

  it('health-проверка по http не редиректится', () => {
    vi.stubEnv('APP_ENV', 'production');
    const res = proxy(req('http://localhost/api/health', { 'x-forwarded-proto': 'http' }));
    expect(res.status).not.toBe(301);
  });
});

describe('proxy в разработке', () => {
  it('нет ни редиректа, ни HSTS, но CSP есть', () => {
    const res = proxy(req('http://localhost:3000/catalog', { 'x-forwarded-proto': 'http' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('strict-transport-security')).toBeNull();
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

describe('X-Robots-Tag', () => {
  it.each(['/admin/orders', '/account/orders', '/cart', '/checkout', '/order/RTS-000001', '/pay/test/x', '/search', '/favorites', '/compare', '/api/cart'])(
    '%s закрыт от индексации',
    (path) => {
      expect(proxy(req(`http://localhost:3000${path}`)).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    },
  );
  it.each(['/', '/catalog/trimmery', '/product/x', '/contacts'])('%s не закрыт', (path) => {
    expect(proxy(req(`http://localhost:3000${path}`)).headers.get('x-robots-tag')).toBeNull();
  });
});
