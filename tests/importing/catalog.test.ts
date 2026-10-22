import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyImport } from '@/importing/yml/apply';
import { parseYml } from '@/importing/yml/parse';
import { planImport } from '@/importing/yml/plan';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';
import { productsRepo } from '@/server/db/repositories/products';

// Ожидаемые числа посчитаны независимо от кода импорта (grep/регулярками по самому файлу).
type Expected = {
  categories: number;
  subcategories: number;
  offersInFile: number;
  products: number;
  emptyPriceRows: number;
  unavailable: number;
  withDescription: number;
  attributes: number;
  images: number;
};

const FIXTURE = join(process.cwd(), 'tests/fixtures/catalog-sample.yml');
const FULL = process.env.CATALOG_YML ?? join(process.cwd(), '.autopilot/2026-10-22-remtehsad-shop--wip/inputs/catalog.yml');

const count = (db: Db, sql: string) => (db.prepare(sql).get() as { n: number }).n;

function suite(title: string, path: string, e: Expected, skip: boolean) {
  if (skip) console.warn(`[catalog.test] ПРОПУЩЕНО «${title}»: файл ${path} не найден. Укажите путь в CATALOG_YML или положите файл.`);
  describe.skipIf(skip)(title, () => {
    const xml = skip ? '' : readFileSync(path, 'utf8');

    it('разбор: категории, товары, строки с пустой ценой — в ошибки', () => {
      const p = parseYml(xml);
      expect(p.categories).toHaveLength(e.categories);
      expect(p.categories.filter((c) => c.parentExternalId !== null)).toHaveLength(e.subcategories);
      expect(p.offers).toHaveLength(e.products);
      const priceErrors = p.errors.filter((x) => x.kind === 'offer');
      expect(priceErrors).toHaveLength(e.emptyPriceRows);
      expect(priceErrors.every((x) => /цен/i.test(x.message))).toBe(true);
      expect(p.offers.every((o) => o.sku !== null && o.priceKopecks > 0)).toBe(true);
      expect(p.offers.filter((o) => !o.inStock)).toHaveLength(e.unavailable);
      expect(p.offers.filter((o) => o.description !== null)).toHaveLength(e.withDescription);
    });

    it('применение создаёт все категории и товары; второй запуск — 0 создано, 0 изменено, без дублей', async () => {
      const db = createTestDb();
      const first = await applyImport(planImport(parseYml(xml), db), db);
      expect(first.categories.created).toBe(e.categories);
      expect(first.products).toMatchObject({ created: e.products, updated: 0 });
      expect(first.errors.filter((x) => x.kind === 'offer')).toHaveLength(e.emptyPriceRows);

      const snapshot = {
        categories: count(db, 'SELECT COUNT(*) AS n FROM categories'),
        products: count(db, 'SELECT COUNT(*) AS n FROM products'),
        slugs: count(db, 'SELECT COUNT(DISTINCT slug) AS n FROM products'),
        attributes: count(db, 'SELECT COUNT(*) AS n FROM product_attributes'),
        images: count(db, 'SELECT COUNT(*) AS n FROM product_images'),
        outOfStock: count(db, 'SELECT COUNT(*) AS n FROM products WHERE in_stock = 0'),
        subcategories: count(db, 'SELECT COUNT(*) AS n FROM categories WHERE parent_id IS NOT NULL'),
      };
      expect(snapshot).toEqual({ categories: e.categories, products: e.products, slugs: e.products, attributes: e.attributes, images: e.images, outOfStock: e.unavailable, subcategories: e.subcategories });

      const second = await applyImport(planImport(parseYml(xml), db), db);
      expect(second.categories).toMatchObject({ created: 0, updated: 0 });
      expect(second.products).toMatchObject({ created: 0, updated: 0, unchanged: e.products });
      expect(count(db, 'SELECT COUNT(*) AS n FROM products')).toBe(e.products);
      expect(count(db, 'SELECT COUNT(*) AS n FROM categories')).toBe(e.categories);
      expect(count(db, 'SELECT COUNT(*) AS n FROM import_runs')).toBe(2);
    });

    it('артикул = model, цена в копейках, slug из url', async () => {
      const db = createTestDb();
      await applyImport(planImport(parseYml(xml), db), db);
      const first = parseYml(xml).offers[0]!;
      const row = productsRepo.findByExternalId(db, 'yml', first.externalId)!;
      const model = new RegExp(`<offer id="${first.externalId}"[\\s\\S]*?<model>([^<]*)</model>[\\s\\S]*?<price>([\\d.]+)</price>[\\s\\S]*?<url>[^<]*/([^/<]+)/?</url>`).exec(xml)!;
      expect(row.sku).toBe(model[1]);
      expect(row.priceKopecks).toBe(Math.round(Number(model[2]) * 100));
      expect(row.slug).toBe(model[3]!.toLowerCase());
    });
  });
}

suite(
  'фрагмент каталога (tests/fixtures)',
  FIXTURE,
  { categories: 19, subcategories: 10, offersInFile: 29, products: 28, emptyPriceRows: 1, unavailable: 7, withDescription: 15, attributes: 420, images: 339 },
  !existsSync(FIXTURE),
);

suite(
  'полный каталог champion (1218 товаров, 185 категорий)',
  FULL,
  { categories: 185, subcategories: 139, offersInFile: 1218, products: 1214, emptyPriceRows: 4, unavailable: 227, withDescription: 311, attributes: 12314, images: 6162 },
  !existsSync(FULL),
);
