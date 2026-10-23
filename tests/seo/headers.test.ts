import { describe, expect, it } from 'vitest';
import { buildCsp, HSTS_VALUE, staticSecurityHeaders } from '@/domain/seo/headers';

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name} `)) ?? '';

describe('CSP', () => {
  it('разрешает фото champion.ru и плитки OpenStreetMap, запрещает встраивание', () => {
    const csp = buildCsp({ nonce: 'abc', development: false, upgradeInsecure: true });
    const img = directive(csp, 'img-src');
    for (const src of ["'self'", 'data:', 'https://champion.ru', 'https://*.champion.ru', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org']) {
      expect(img.split(' ')).toContain(src);
    }
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'script-src')).toContain("'nonce-abc'");
    expect(directive(csp, 'script-src')).not.toContain('unsafe-eval');
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('в разработке нужен unsafe-eval, а upgrade-insecure-requests нет (иначе http://localhost ломается)', () => {
    const csp = buildCsp({ nonce: 'abc', development: true });
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

describe('статические защитные заголовки', () => {
  it('содержат nosniff, Referrer-Policy, Permissions-Policy и запрет фреймов', () => {
    const map = new Map(staticSecurityHeaders().map((h) => [h.key.toLowerCase(), h.value]));
    expect(map.get('x-content-type-options')).toBe('nosniff');
    expect(map.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(map.get('permissions-policy')).toContain('camera=()');
    expect(map.get('x-frame-options')).toBe('DENY');
    expect(HSTS_VALUE).toMatch(/max-age=\d{7,}/);
  });
});
