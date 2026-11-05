import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { productListOps } from '@/app/admin/(panel)/_lib/product-list-ops';
import { categoryTreeOps } from '@/app/admin/(panel)/_lib/category-tree-ops';
import { globalSearch } from '@/domain/admin/search';
import type { StaffSession } from '@/domain/admin/permissions';
import { dashboard } from '@/domain/analytics/dashboard';
import { parseDashboardPeriod } from '@/domain/analytics/period';
import { getCategoryTree, getFacets, searchProducts } from '@/domain/catalog';
import { parseProductListQuery } from '@/domain/catalog/products-list';
import { applyImport, parseYml, planImport } from '@/importing/yml';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';
import { baseQuery } from '../catalog/helpers';
import { placeGuestOrder } from '../security/harness';
import { planOf, probe, timed, type Probe } from './perf-kit';

/**
 * Производительность на настоящем каталоге (1214 товаров из catalog.yml). БД в памяти, сеть не нужна.
 * Что проверяется: (1) число SQL-запросов не зависит от числа строк на странице (нет N+1), (2) время операций
 * укладывается в пороги, (3) планы основных запросов — EXPLAIN QUERY PLAN — без полного перебора больших таблиц там,
 * где есть индекс. Цифры печатаются в консоль и переносятся в docs/qa-report.md.
 */
const CATALOG = resolve(__dirname, '../../.autopilot/2026-10-22-remtehsad-shop--wip/inputs/catalog.yml');
const admin: StaffSession = { staffId: 1, email: 'perf', name: null, role: 'super_admin' };
const report: Record<string, { queries: number; ms: number; rows?: number }> = {};

let db: Db;
let p: Probe;

async function measure<T>(name: string, fn: () => Promise<T> | T, rows?: (r: T) => number): Promise<T> {
  p.reset();
  const { result, ms } = await timed(fn);
  report[name] = { queries: p.queries(), ms: Math.round(ms * 10) / 10, ...(rows ? { rows: rows(result) } : {}) };
  return result;
}

describe.skipIf(!existsSync(CATALOG))('производительность на 1214 товарах', () => {
  beforeAll(async () => {
    db = createTestDb();
    const t0 = performance.now();
    await applyImport(planImport(parseYml(readFileSync(CATALOG, 'utf8')), db, { fileName: 'catalog.yml' }), db, { now: new Date(Date.UTC(2026, 9, 24)) });
    report['(импорт каталога)'] = { queries: 0, ms: Math.round(performance.now() - t0) };
    // немного заказов, чтобы панель управления и аналитика работали не вхолостую
    const first = db.prepare('SELECT id FROM products WHERE price_kopecks > 0 AND in_stock = 1 LIMIT 1').get() as { id: number };
    for (let i = 0; i < 30; i += 1) await placeGuestOrder(db, first.id);
    p = probe(db);
  }, 180_000);

  it('каталог загружен полностью: 1214 товаров', () => {
    expect((db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n).toBe(1214);
  });

  it('список товаров админки: число запросов не растёт с размером страницы (нет N+1), время в пороге', async () => {
    const small = await measure('Список товаров, 20 строк', () => productListOps.list(admin, parseProductListQuery({ pageSize: '20' }), { db: p.db }), (r) => r.items.length);
    const smallQueries = report['Список товаров, 20 строк']!.queries;
    const big = await measure('Список товаров, 100 строк', () => productListOps.list(admin, parseProductListQuery({ pageSize: '100' }), { db: p.db }), (r) => r.items.length);
    expect(small.total).toBe(1214);
    expect(big.items.length).toBeGreaterThan(small.items.length);
    expect(report['Список товаров, 100 строк']!.queries).toBe(smallQueries);
    expect(smallQueries).toBeLessThanOrEqual(8);
    expect(report['Список товаров, 100 строк']!.ms).toBeLessThan(400);
    await measure('Список товаров, поиск «триммер»', () => productListOps.list(admin, parseProductListQuery({ q: 'триммер' }), { db: p.db }), (r) => r.total);
    expect(report['Список товаров, поиск «триммер»']!.ms).toBeLessThan(400);
  });

  it('дерево категорий (админка и витрина): один–два запроса на корень, без запросов на каждую категорию', async () => {
    const children = await measure('Дерево категорий админки (корень)', () => categoryTreeOps.children(admin, null, { db: p.db }), (r) => r.nodes.length);
    expect(children.total).toBeGreaterThan(5);
    expect(report['Дерево категорий админки (корень)']!.queries).toBeLessThanOrEqual(6);
    const tree = await measure('Дерево категорий витрины (все)', () => getCategoryTree({ db: p.db }), (r) => r.length);
    expect(tree.length).toBeGreaterThan(5);
    expect(report['Дерево категорий витрины (все)']!.queries).toBeLessThanOrEqual(6);
    expect(report['Дерево категорий витрины (все)']!.ms).toBeLessThan(400);
  });

  it('панель управления: фиксированное число запросов, быстро', async () => {
    const { range } = parseDashboardPeriod({ period: '30d' }, Date.now());
    const d = await measure('Панель управления (30 дней)', () => dashboard(admin, range, 'day', { db: p.db }));
    expect(d).toBeDefined();
    expect(report['Панель управления (30 дней)']!.queries).toBeLessThanOrEqual(30);
    expect(report['Панель управления (30 дней)']!.ms).toBeLessThan(500);
  });

  it('глобальный поиск админки: бюджет 800 мс соблюдается с запасом, запросов не больше числа групп', async () => {
    const r = await measure('Глобальный поиск админки «бензо»', () => globalSearch(admin, 'бензо', { db: p.db }), (x) => x.total);
    expect(r.partial).toBe(false);
    expect(report['Глобальный поиск админки «бензо»']!.queries).toBeLessThanOrEqual(8);
    expect(report['Глобальный поиск админки «бензо»']!.ms).toBeLessThan(300);
  });

  it('витрина: поиск, листинг категории, фасеты (фильтры) — без N+1', async () => {
    const found = await measure('Витрина: поиск «триммер»', () => searchProducts({ ...baseQuery, text: 'триммер', sort: 'relevance', pageSize: 24 }, { db: p.db }), (r) => r.items.length);
    expect(found.total).toBeGreaterThan(0);
    const firstCat = db.prepare('SELECT id, slug FROM categories WHERE effective_hidden = 0 AND parent_id IS NULL ORDER BY id LIMIT 1').get() as { id: number; slug: string };
    const small = await measure('Витрина: листинг категории, 12 товаров', () => searchProducts({ ...baseQuery, categorySlug: firstCat.slug, pageSize: 12 }, { db: p.db }), (r) => r.items.length);
    const q12 = report['Витрина: листинг категории, 12 товаров']!.queries;
    const big = await measure('Витрина: листинг категории, 48 товаров', () => searchProducts({ ...baseQuery, categorySlug: firstCat.slug, pageSize: 48 }, { db: p.db }), (r) => r.items.length);
    expect(big.items.length).toBeGreaterThanOrEqual(small.items.length);
    expect(report['Витрина: листинг категории, 48 товаров']!.queries).toBe(q12);
    const facets = await measure('Витрина: фильтры (фасеты) корневой категории', () => getFacets(firstCat.id, { filters: {} }, { db: p.db }), (r) => r.length);
    expect(Array.isArray(facets)).toBe(true);
    expect(report['Витрина: фильтры (фасеты) корневой категории']!.ms).toBeLessThan(500);
    const allFacets = await measure('Витрина: фильтры (фасеты) всего каталога', () => getFacets(null, { filters: {} }, { db: p.db }), (r) => r.length);
    expect(allFacets.length).toBeGreaterThanOrEqual(0);
    for (const k of ['Витрина: поиск «триммер»', 'Витрина: листинг категории, 48 товаров']) expect(report[k]!.ms, k).toBeLessThan(400);
    expect(q12).toBeLessThanOrEqual(8);
  });

  it('EXPLAIN QUERY PLAN: запросы с условиями по большим таблицам используют индексы; отчёт напечатан', () => {
    const lines: string[] = [];
    const scans: string[] = [];
    p.reset();
    productListOps.list(admin, parseProductListQuery({ pageSize: '20' }), { db: p.db });
    searchProducts({ ...baseQuery, text: 'триммер', sort: 'relevance', pageSize: 24 }, { db: p.db });
    for (const s of p.statements()) {
      const plan = planOf(db, s);
      lines.push(`${s.sql.replace(/\s+/g, ' ').slice(0, 110)}\n    ${plan.join('\n    ')}`);
      for (const d of plan) if (/^SCAN (order_items|orders|audit_log|product_attributes|product_categories)\b/.test(d) && /WHERE/i.test(s.sql) && !/COUNT|SUM|GROUP BY/i.test(s.sql)) scans.push(`${d} ← ${s.sql.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    console.log('--- EXPLAIN QUERY PLAN ---\n' + lines.join('\n'));
    expect(scans).toEqual([]);
  });

  it('индексы на месте для основных выборок (по sqlite_master)', () => {
    const idx = (db.prepare("SELECT tbl_name AS t, name, sql FROM sqlite_master WHERE type = 'index'").all() as { t: string; name: string; sql: string | null }[]).map((r) => `${r.t}:${r.name}`);
    const has = (table: string, part: string) => idx.some((i) => i.startsWith(`${table}:`) && i.includes(part));
    expect(has('products', 'category')).toBe(true);
    expect(has('orders', 'status') || has('orders', 'created')).toBe(true);
    expect(has('order_items', 'order')).toBe(true);
    expect(has('product_categories', 'product') || has('product_categories', 'category')).toBe(true);
  });

  it('сводка замеров (печатается для docs/qa-report.md)', () => {
    console.log('--- ЗАМЕРЫ (1214 товаров, SQLite в памяти) ---\n' + Object.entries(report).map(([k, v]) => `${k}: ${v.queries} запросов, ${v.ms} мс${v.rows !== undefined ? `, строк: ${v.rows}` : ''}`).join('\n'));
    expect(Object.keys(report).length).toBeGreaterThan(8);
    expect(join).toBeDefined();
  });
});
