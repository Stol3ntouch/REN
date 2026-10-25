import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaffSession } from '@/domain/admin/staff-session';
import { setSetting } from '@/domain/content/settings';
import { decideStoreGate, gatePageFor, renderGatePage } from '@/domain/content/store-gate';
import { createTestDb } from '@/server/db/testing';
import { fakeCookies } from '../auth/helpers';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/server/db/connection', async (orig) => {
  const mod = await orig<typeof import('@/server/db/connection')>();
  return { ...mod, getDb: () => state.db as ReturnType<typeof mod.getDb> };
});

import { proxy } from '@/proxy';

const NOW = Date.UTC(2026, 9, 25, 12);
const staffCookie = (db: ReturnType<typeof createTestDb>): string => {
  db.prepare("INSERT INTO staff (id, email, name, role_id, password_hash, created_at) VALUES (1, 'a@x.test', 'A', (SELECT id FROM roles WHERE code = 'admin'), 'x', 1)").run();
  const jar = fakeCookies();
  createStaffSession(jar, 1, { db, now: Date.now() });
  return `rts_admin_session=${jar.jar.get('rts_admin_session')}`;
};
const req = (path: string, init: { headers?: Record<string, string>; method?: string } = {}) => new NextRequest(`https://shop.test${path}`, init);

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  state.db = db;
});
afterEach(() => vi.unstubAllEnvs());

describe('«Включить магазин»', () => {
  it('выключен → витрина 503 «Магазин временно закрыт» с телефоном и адресом из настроек', async () => {
    setSetting('flag_store_enabled', '0', { db });
    setSetting('phone', '+7 900 111-22-33', { db });
    setSetting('address', 'ул. Тестовая, 1', { db });
    for (const path of ['/', '/catalog', '/product/x', '/account/login']) {
      const res = proxy(req(path));
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBeTruthy();
      const html = await res.text();
      expect(html).toContain('Магазин временно закрыт');
      expect(html).toContain('+7 900 111-22-33');
      expect(html).toContain('ул. Тестовая, 1');
    }
  });

  it('админка, /api/health, вебхук оплаты, статика и robots доступны', () => {
    setSetting('flag_store_enabled', '0', { db });
    for (const path of ['/admin', '/admin/login', '/api/health', '/api/payment/webhook', '/brand/logo.png', '/robots.txt']) {
      expect(proxy(req(path)).status).toBe(200);
    }
  });

  it('включён → всё открыто', () => {
    expect(proxy(req('/')).status).toBe(200);
  });

  it('значения без заполненных контактов не выдумываются', async () => {
    setSetting('flag_store_enabled', '0', { db });
    for (const k of ['phone', 'address', 'email']) setSetting(k, '', { db });
    const html = await proxy(req('/')).text();
    expect(html).not.toMatch(/Телефон|Адрес/);
  });
});

describe('«Режим технического обслуживания»', () => {
  it('посетитель получает 503 с сообщением из настроек (экранированным)', async () => {
    setSetting('flag_maintenance', '1', { db });
    setSetting('maintenance_message', 'Вернёмся <b>завтра</b>', { db });
    const res = proxy(req('/'));
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toContain('Технические работы');
    expect(html).toContain('Вернёмся &lt;b&gt;завтра&lt;/b&gt;');
  });

  it('сотрудник с активной сессией видит сайт', () => {
    setSetting('flag_maintenance', '1', { db });
    const cookie = staffCookie(db);
    expect(proxy(req('/', { headers: { cookie } })).status).toBe(200);
  });

  it('просроченная или поддельная сессия не пускает', () => {
    setSetting('flag_maintenance', '1', { db });
    expect(proxy(req('/', { headers: { cookie: 'rts_admin_session=fake' } })).status).toBe(503);
  });

  it('админка и проверка живости открыты и в обслуживании', () => {
    setSetting('flag_maintenance', '1', { db });
    expect(proxy(req('/admin/login')).status).toBe(200);
    expect(proxy(req('/api/health')).status).toBe(200);
  });
});

describe('«Показывать цены»', () => {
  it('выключен → API корзины 403, страницы корзины и оформления недоступны, остальное открыто', async () => {
    setSetting('flag_show_prices', '0', { db });
    for (const method of ['GET', 'POST']) {
      const res = proxy(req('/api/cart/items', { method }));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('prices_hidden');
    }
    expect(proxy(req('/api/cart')).status).toBe(403);
    expect(proxy(req('/checkout', { method: 'POST' })).status).toBe(403);
    expect(proxy(req('/cart')).status).toBe(403);
    expect(proxy(req('/catalog')).status).toBe(200);
    expect(proxy(req('/order/ABC')).status).toBe(200);
  });

  it('включён → корзина открыта', () => {
    expect(proxy(req('/api/cart')).status).toBe(200);
  });
});

describe('страница ответа', () => {
  it('самодостаточная, noindex, с nonce в стиле', () => {
    const html = renderGatePage('closed', { shop: { siteName: 'Сад', phone: null, phoneHref: null, address: null, email: null }, nonce: 'abc' });
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('nonce="abc"');
  });

  it('decideStoreGate без БД ничего не блокирует', () => {
    expect(decideStoreGate({ pathname: '/', isStaff: () => false }, { db: { prepare: () => { throw new Error('x'); } } as never })).toEqual({ kind: 'pass' });
    expect(gatePageFor({ kind: 'page', status: 503, reason: 'closed' }, 'n', { db: { prepare: () => { throw new Error('x'); } } as never }).html).toContain('Магазин временно закрыт');
  });
});

void NOW;
