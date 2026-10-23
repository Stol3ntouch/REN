import { describe, expect, it } from 'vitest';
import { buildRobots } from '@/domain/seo/robots';

describe('robots', () => {
  it('закрывает служебные разделы и указывает sitemap', () => {
    const r = buildRobots('https://shop.example.ru');
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const disallow = ([] as string[]).concat(rule?.disallow ?? []);
    for (const p of ['/admin', '/account', '/cart', '/checkout', '/api', '/pay', '/order']) expect(disallow).toContain(p);
    expect(rule?.allow).toBe('/');
    expect(r.sitemap).toBe('https://shop.example.ru/sitemap.xml');
  });
});
