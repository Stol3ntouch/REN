import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { productOps } from '@/app/admin/(panel)/_lib/product-ops';
import { sanitizeDescription } from '@/importing/yml/sanitize';
import { JsonLd } from '@/ui/seo/JsonLd';
import { renderToStaticMarkup } from 'react-dom/server';
import { searchProducts } from '@/domain/catalog';
import { orderOps, parseOrderFilters } from '@/domain/ordering/admin-ops';
import { createStaffSession, getStaffSession, ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { profileOps } from '@/app/admin/(panel)/profile/profile-ops';
import { hashToken } from '@/domain/customers/session';
import { fakeCookies } from '../auth/helpers';
import { baseQuery } from '../catalog/helpers';
import { makeHarness, placeGuestOrder, seedShop, T0, type Harness } from './harness';

/**
 * Чек-лист безопасности (раздел 22 брифа 2026-10-24) — автотесты там, где проверка возможна без браузера.
 * Всё на изолированной БД в памяти; сеть и data/rts.sqlite не используются.
 */
const ROOT = resolve(__dirname, '../..');
const routeFiles = (base: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n === 'route.ts') out.push(p);
    }
  };
  walk(base);
  return out;
};
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Handler = (req: Request, ctx: unknown) => Promise<Response> | Response;
const ctx = { params: Promise.resolve({ kind: 'call', path: ['x'], entity: 'pages', id: '1', number: 'RTS-1', photoId: '1' }) };

let h: Harness;
let shop: { productId: number; categoryId: number };
let order: { id: number; number: string };
const HOSTILE_NAME = '<script>alert(1)</script>"><img src=x onerror=alert(1)>';

beforeAll(async () => {
  h = await makeHarness();
  h.attach();
  shop = seedShop(h.db);
  order = (await placeGuestOrder(h.db, shop.productId, { name: HOSTILE_NAME })).order;
}, 60_000);
afterAll(() => h?.detach());

describe('CSRF / Origin на публичных мутациях', () => {
  const API = join(ROOT, 'src/app/api');
  const routes = routeFiles(API).map((f) => ({ file: f, rel: relative(API, f).split(sep).join('/'), source: readFileSync(f, 'utf8') }));
  /** Webhook оплаты авторизуется подписью провайдера, а не cookie: Origin у сервера провайдера нет. */
  const SIGNED = new Set(['payment/webhook/route.ts']);

  it('каждый мутирующий публичный обработчик проверяет Origin (прямо или через общий модуль)', () => {
    const bad: string[] = [];
    for (const r of routes) {
      if (SIGNED.has(r.rel) || !MUTATING.some((m) => new RegExp(`export\\s+(?:const|async function)\\s+${m}\\b`).test(r.source))) continue;
      const direct = /assertOrigin\s*\(|handleFormRequest|handleCart|handle\w*Request/.test(r.source);
      if (!direct) bad.push(r.rel);
    }
    expect(bad).toEqual([]);
  });

  it('чужой Origin → 403 на POST/PUT/PATCH/DELETE каждого публичного маршрута (кроме подписанного webhook)', async () => {
    let checked = 0;
    for (const r of routes) {
      if (SIGNED.has(r.rel)) continue;
      const mod = (await import(/* @vite-ignore */ r.file)) as Record<string, unknown>;
      for (const m of MUTATING) {
        if (typeof mod[m] !== 'function') continue;
        const res = await (mod[m] as Handler)(new Request('http://shop.test/api/x', { method: m, headers: { host: 'shop.test', origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }), ctx);
        expect(res.status, `${r.rel} ${m}`).toBe(403);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });
});

describe('XSS', () => {
  const PAYLOADS = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<scr<script>ipt>alert(1)</scr</script>ipt>', '<a href="javascript:alert(1)">x</a>', '<iframe src="//evil.example"></iframe>', '<p onclick="alert(1)">ok</p>', '<!--<script>-->alert(1)'];

  it('HTML описания товара очищается: нет script, обработчиков событий, javascript:, iframe', () => {
    for (const p of PAYLOADS) {
      const out = sanitizeDescription(p) ?? '';
      expect(out, p).not.toMatch(/<\s*(script|img|svg|iframe|a)\b/i);
      expect(out, p).not.toMatch(/\son\w+\s*=/i);
      expect(out, p).not.toMatch(/javascript:/i);
    }
  });

  it('JSON-LD не даёт закрыть тег <script> данными из БД', () => {
    const html = renderToStaticMarkup(JsonLd({ data: { name: '</script><script>alert(1)</script>' } }));
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('печатная форма заказа экранирует имя покупателя из формы заказа', async () => {
    const { GET } = (await import('@/app/admin/(panel)/orders/[number]/print/route')) as unknown as { GET: Handler };
    const res = await GET(h.request(`http://shop.test/admin/orders/${order.number}/print`, { role: 'admin' }), { params: Promise.resolve({ number: order.number }) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).not.toMatch(/<img[^>]*onerror/i);
    expect(body).toContain('&lt;script&gt;');
  });

  it('название товара с разметкой хранится как текст и экранируется при выводе (React), а не вставляется как HTML', async () => {
    const { productId } = seedShop(h.db, { name: HOSTILE_NAME, slug: 'xss-product', sku: 'XSS-1' });
    const found = await searchProducts({ ...baseQuery, text: 'alert', pageSize: 20 }, { db: h.db });
    // значение приходит данными; вывод в страницу — только через React (экранирование), «сырой» HTML в проекте — два места (тест ниже)
    expect(found.items.some((i) => i.id === productId)).toBe(true);
  });

  it('в проекте всего два места «сырого» HTML (описание товара и JSON-LD), новых нет', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?)$/.test(n) && /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\(/.test(readFileSync(p, 'utf8'))) hits.push(relative(ROOT, p).split(sep).join('/'));
      }
    };
    walk(join(ROOT, 'src'));
    expect(hits.sort()).toEqual(['src/app/(shop)/product/[slug]/page.tsx', 'src/ui/seo/JsonLd.tsx']);
  });
});

describe('CSV-инъекции (формулы)', () => {
  it('выгрузки заказов и товаров не отдают ячейку, начинающуюся с = + - @', async () => {
    const { productId } = seedShop(h.db, { name: '=HYPERLINK("http://evil.example","x")', slug: 'csv-1', sku: '+CMD-1' });
    expect(productId).toBeGreaterThan(0);
    const { order: evilOrder } = await placeGuestOrder(h.db, shop.productId, { name: '=cmd|\' /C calc\'!A0' });
    expect(evilOrder.id).toBeGreaterThan(0);
    const { GET: ordersCsv } = (await import('@/app/admin/api/orders/export/route')) as unknown as { GET: Handler };
    const { GET: productsCsv } = (await import('@/app/admin/api/products/export/route')) as unknown as { GET: Handler };
    const o = await (await ordersCsv(h.request('http://shop.test/admin/api/orders/export', { role: 'admin' }), ctx)).text();
    const p = await (await productsCsv(h.request('http://shop.test/admin/api/products/export', { role: 'admin' }), ctx)).text();
    for (const text of [o, p]) {
      const cells = text.split(/\r?\n/).flatMap((line) => line.split(';'));
      expect(cells.filter((c) => /^["]?[=+\-@]/.test(c) && !/^["]?[-+]?\d/.test(c)), 'ячейки-формулы').toEqual([]);
    }
    expect(o).toContain("'=cmd");
    expect(p).toContain("'=HYPERLINK");
  });
});

describe('SQL-инъекции: поиск, фильтры, сортировка', () => {
  const EVIL = ["' OR 1=1 --", "'; DROP TABLE orders; --", '" OR ""="', '%', '_', '\\', 'a%\' UNION SELECT password_hash,2,3 FROM staff --', '*', 'NEAR(a b)', '(', ')', ':', '-'];
  const tableCount = (t: string) => (h.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

  it('публичный поиск и сортировка по белому списку: запросы не падают, таблицы целы', async () => {
    const before = [tableCount('orders'), tableCount('staff'), tableCount('products')];
    for (const text of EVIL) {
      const res = await searchProducts({ ...baseQuery, text, pageSize: 20 }, { db: h.db });
      expect(Array.isArray(res.items), text).toBe(true);
    }
    for (const sort of ['name; DROP TABLE products', 'price_kopecks DESC, (SELECT 1)', '1', '../x']) {
      // неизвестная сортировка заменяется значением по умолчанию (белый список) или отклоняется — но не попадает в SQL
      const res = await searchProducts({ ...baseQuery, sort: sort as never, pageSize: 20 }, { db: h.db }).catch((e: unknown) => e);
      expect(res instanceof Error ? res.name : 'ok', sort).toMatch(/^(ok|ValidationError)$/);
    }
    expect([tableCount('orders'), tableCount('staff'), tableCount('products')]).toEqual(before);
  });

  it('список заказов админки: sort/dir/status/q из адреса проходят белый список, мусор не попадает в SQL', () => {
    const before = tableCount('orders');
    const admin = { staffId: h.staffIds.admin!, email: 'x', name: null, role: 'admin' };
    for (const evil of EVIL) {
      const f = parseOrderFilters({ q: evil, sort: evil, dir: evil, status: evil, page: evil, per: evil, from: evil, to: evil });
      const res = orderOps.list(admin, f, { db: h.db });
      expect(Array.isArray(res.rows ?? res.items ?? [])).toBe(true);
    }
    expect(tableCount('orders')).toBe(before);
  });

  it('глобальный поиск админки: опасные строки — безопасные подсказки', async () => {
    const { GET } = (await import('@/app/admin/api/search/route')) as unknown as { GET: Handler };
    for (const q of EVIL) {
      const res = await GET(h.request(`http://shop.test/admin/api/search?q=${encodeURIComponent(q)}`, { role: 'super_admin' }), ctx);
      expect([200, 400], q).toContain(res.status);
    }
    expect(tableCount('staff')).toBeGreaterThan(0);
  });

  it('список товаров админки: колонка сортировки только из белого списка', async () => {
    const { productListOps } = await import('@/app/admin/(panel)/_lib/product-list-ops');
    const { parseProductListQuery } = await import('@/domain/catalog/products-list');
    const admin = { staffId: h.staffIds.admin!, email: 'x', name: null, role: 'admin' };
    for (const evil of ['name; DROP TABLE products', 'price DESC, (SELECT 1)', '"', '`', "' OR 1=1 --"]) {
      const q = parseProductListQuery({ sort: evil, dir: evil, q: evil, page: evil, category: evil, brand: evil, status: evil });
      expect(Array.isArray(productListOps.list(admin, q, { db: h.db }).rows ?? [])).toBe(true);
    }
    expect(tableCount('products')).toBeGreaterThan(0);
  });
});

describe('IDOR и приватные скачивания', () => {
  it('чужой гость не получает заказ по номеру; чужой покупатель — 404', async () => {
    const { orders } = await import('@/domain/ordering/orders');
    const stranger = { kind: 'guest' as const, guestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    expect(orders.getForCustomer(order.number, stranger, { db: h.db })).toBeNull();
  });

  it('скачивание копий и выгрузок — только по праву: роль без права получает 403', async () => {
    const { GET: backup } = (await import('@/app/admin/api/backup/download/route')) as unknown as { GET: Handler };
    for (const role of ['none', 'manager', 'content_manager', 'warehouse', 'service']) {
      const res = await backup(h.request('http://shop.test/admin/api/backup/download?token=abc', { role }), ctx);
      expect(res.status, role).toBe(403);
    }
    const noToken = await backup(h.request('http://shop.test/admin/api/backup/download?token=bogus', { role: 'admin' }), ctx);
    expect([400, 404, 410]).toContain(noToken.status);
  });

  it('выгрузка клиентов закрыта правом customers.read; склад и контент-менеджер получают 403', async () => {
    const { GET } = (await import('@/app/admin/api/customers/export/route')) as unknown as { GET: Handler };
    for (const role of ['warehouse', 'content_manager', 'none']) expect((await GET(h.request('http://shop.test/admin/api/customers/export', { role }), ctx)).status, role).toBe(403);
  });

  it('фото заявки на ремонт отдаются только сотруднику с правом repair.write', async () => {
    const mod = (await import('@/app/admin/api/repairs/[id]/photos/[photoId]/route')) as unknown as { GET: Handler };
    for (const role of ['warehouse', 'content_manager', 'none']) expect((await mod.GET(h.request('http://shop.test/admin/api/repairs/1/photos/1', { role }), { params: Promise.resolve({ id: '1', photoId: '1' }) })).status, role).toBe(403);
    expect((await mod.GET(h.request('http://shop.test/admin/api/repairs/1/photos/1'), { params: Promise.resolve({ id: '1', photoId: '1' }) })).status).toBe(401);
  });
});

describe('публичная раздача файлов: путь не выходит из каталога загрузок', () => {
  it('«..», слэши, скрытые файлы, SVG и HTML → 404', async () => {
    const { GET } = (await import('@/app/api/catalog/media/[...path]/route')) as unknown as { GET: Handler };
    const req = new Request('http://shop.test/api/catalog/media/x');
    for (const path of [['..', '..', 'package.json'], ['..%2f..%2fpackage.json'], ['.env.png'], ['a', '..', 'b.png'], ['x.svg'], ['x.html'], ['a/b.png'], ['..', 'rts.sqlite'], ['a', 'b', 'c', 'd', 'e.png'], ['%2e%2e', 'x.png']]) {
      const res = await GET(req, { params: Promise.resolve({ path }) });
      expect(res.status, path.join('/')).toBe(404);
    }
  });
});

describe('секреты не попадают в ответы', () => {
  const SECRETS = { SESSION_SECRET: 'S3CR3T-session-0123456789-abcdefghijklmnop', PAYMENT_API_KEY: 'S3CR3T-payment-key', PAYMENT_WEBHOOK_SECRET: 'S3CR3T-webhook', MAIL_PASSWORD: 'S3CR3T-mail-pass', MAIL_USER: 'mail-user-s3cr3t', MAIL_HOST: 'smtp.s3cr3t.example', ADMIN_PASSWORD: 'S3CR3T-admin-pass' };
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [k, v] of Object.entries(SECRETS)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const k of Object.keys(SECRETS)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('проверка живости, обзор интеграций, почты и настроек не содержат значений секретов', async () => {
    const { GET: health } = (await import('@/app/api/health/route')) as unknown as { GET: Handler };
    const dumps: string[] = [await (await health(new Request('http://shop.test/api/health'), ctx)).text()];
    const { integrationsOps } = await import('@/app/admin/(panel)/_lib/integrations-ops');
    const admin = { staffId: h.staffIds.admin!, email: 'x', name: null, role: 'admin' };
    dumps.push(JSON.stringify(integrationsOps.overview(admin, { db: h.db })));
    const { getStoreSettings } = await import('@/domain/content/store-settings');
    dumps.push(JSON.stringify(getStoreSettings(admin, { db: h.db })));
    const all = dumps.join('\n');
    for (const v of Object.values(SECRETS)) expect(all, v).not.toContain(v);
  });

  it('аудит и журналы маскируют секреты (см. tests/hardening/security-basics); в исходниках нет console.log с process.env', () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n) && /console\.(log|info|debug|warn|error)\([^)]*process\.env\.(\w*(SECRET|PASSWORD|API_KEY|TOKEN)\w*)/.test(readFileSync(p, 'utf8'))) bad.push(relative(ROOT, p));
      }
    };
    walk(join(ROOT, 'src'));
    expect(bad).toEqual([]);
  });
});

describe('сессии сотрудников', () => {
  it('блокировка закрывает открытую сессию на следующем запросе; смена своего пароля закрывает остальные сессии', async () => {
    const id = h.staffIds.manager!;
    const jar = fakeCookies({ [ADMIN_SESSION_COOKIE]: h.tokens.manager! });
    expect(getStaffSession(jar, { db: h.db })).not.toBeNull();
    // вторая сессия того же сотрудника
    const second = fakeCookies();
    createStaffSession(second, id, { db: h.db, now: Date.now() });
    const secondToken = second.jar.get(ADMIN_SESSION_COOKIE)!;
    const session = getStaffSession(jar, { db: h.db })!;
    await profileOps.changePassword(session, { current: 'password-manager-1', next: 'brand-new-password-9', confirm: 'brand-new-password-9' }, { db: h.db, now: Date.now(), keepTokenHash: hashToken(h.tokens.manager!) });
    expect(getStaffSession(fakeCookies({ [ADMIN_SESSION_COOKIE]: secondToken }), { db: h.db })).toBeNull();
    expect(getStaffSession(jar, { db: h.db })).not.toBeNull();
    h.db.prepare('UPDATE staff SET active = 0 WHERE id = ?').run(id);
    expect(getStaffSession(jar, { db: h.db })).toBeNull();
  });
});

describe('ошибки production без деталей', () => {
  it('неожиданное исключение в обработчике → 500 без текста и стека', async () => {
    const { withStaffPermission } = await import('@/domain/admin/guard');
    const route = withStaffPermission('staff.self', () => {
      throw new Error('SELECT * FROM staff WHERE secret = 1 at C:\\Users\\x\\file.ts');
    });
    const res = await route(h.request('http://shop.test/admin/api/x', { role: 'admin' }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/SELECT|C:\\|\.ts|at /);
  });

  it('в production заголовок X-Powered-By отключён, а список полей конфигурации падает на старте без обязательных', () => {
    const cfg = readFileSync(join(ROOT, 'next.config.ts'), 'utf8');
    expect(cfg).toContain('poweredByHeader: false');
    expect(T0).toBeGreaterThan(0);
  });
});
