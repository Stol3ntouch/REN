/*
 * Список товаров админки (C05): разбор параметров адреса, серверный отбор, сортировка и пагинация, массовая выборка id,
 * порционная выгрузка. SQL здесь (как в store.ts для витрины): запросы только параметризованные.
 * Чистая часть (разбор адреса, CSV) не зависит от БД; закупочной цены в списке нет — она только в выгрузке и только по праву.
 */
import { ensureFold, foldText } from '@/server/db/fold';
import type { Db } from '@/server/db/connection';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { parseVariants } from '@/server/db/repositories/images';
import { toCatalogImage } from './images';
import { parseRubles } from '@/domain/pricing/format';
import { descendantIds, EFFECTIVE_PRICE, IN_CATEGORIES } from './store';

export const PRODUCT_SORTS = ['name', 'price', 'date', 'stock', 'category'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];
export const PRODUCT_PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PRODUCT_PAGE_SIZE = 20;
export const AVAILABILITIES = ['in_stock', 'out_of_stock', 'preorder', 'discontinued'] as const;
export type ProductAvailability = (typeof AVAILABILITIES)[number];

export const AVAILABILITY_LABELS: Record<ProductAvailability, string> = {
  in_stock: 'В наличии',
  out_of_stock: 'Нет в наличии',
  preorder: 'Под заказ',
  discontinued: 'Снят с продажи',
};

/** Условия отбора (без страницы и сортировки): их же использует выгрузка и «все по фильтру». */
export type ProductFilter = {
  q?: string;
  categoryId?: number;
  brandId?: number;
  availability?: ProductAvailability;
  published?: boolean;
  hidden?: boolean;
  /** Границы цены к оплате, копейки. */
  priceMinKopecks?: number;
  priceMaxKopecks?: number;
  isNew?: boolean;
  featured?: boolean;
  isPromo?: boolean;
};

export type ProductListQuery = ProductFilter & { sort: ProductSort; dir: 'asc' | 'desc'; page: number; pageSize: number };

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();
const posInt = (s: string): number | undefined => {
  const n = Number(s);
  return s !== '' && Number.isInteger(n) && n >= 1 && n <= Number.MAX_SAFE_INTEGER ? n : undefined;
};
const flag = (s: string): boolean | undefined => (s === '1' ? true : s === '0' ? false : undefined);
const MAX_KOPECKS = 10_000_000_000;

/** Разбор отбора из адреса. Неверные значения молча отбрасываются: ручная правка адреса не ломает страницу. */
export function parseProductFilter(sp: Raw): ProductFilter {
  const out: ProductFilter = {};
  const q = one(sp.q).slice(0, 100);
  if (q) out.q = q;
  const category = posInt(one(sp.category));
  if (category) out.categoryId = category;
  const brand = posInt(one(sp.brand));
  if (brand) out.brandId = brand;
  const availability = one(sp.availability);
  if ((AVAILABILITIES as readonly string[]).includes(availability)) out.availability = availability as ProductAvailability;
  const published = flag(one(sp.published));
  if (published !== undefined) out.published = published;
  const hidden = flag(one(sp.hidden));
  if (hidden !== undefined) out.hidden = hidden;
  const min = one(sp.priceMin) ? parseRubles(one(sp.priceMin)) : null;
  if (min !== null && min >= 0 && min <= MAX_KOPECKS) out.priceMinKopecks = min;
  const max = one(sp.priceMax) ? parseRubles(one(sp.priceMax)) : null;
  if (max !== null && max >= 0 && max <= MAX_KOPECKS) out.priceMaxKopecks = max;
  if (one(sp.new) === '1') out.isNew = true;
  if (one(sp.featured) === '1') out.featured = true;
  if (one(sp.promo) === '1') out.isPromo = true;
  return out;
}

export function parseProductListQuery(sp: Raw): ProductListQuery {
  const sort = one(sp.sort);
  const size = Number(one(sp.pageSize));
  return {
    ...parseProductFilter(sp),
    sort: (PRODUCT_SORTS as readonly string[]).includes(sort) ? (sort as ProductSort) : 'date',
    dir: one(sp.dir) === 'asc' ? 'asc' : one(sp.dir) === 'desc' ? 'desc' : (sort && sort !== 'date' ? 'asc' : 'desc'),
    page: posInt(one(sp.page)) ?? 1,
    pageSize: (PRODUCT_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PRODUCT_PAGE_SIZE,
  };
}

/** Отбор → параметры адреса (для ссылок и для передачи фильтра в массовое действие). */
export function filterToParams(f: ProductFilter): Record<string, string> {
  const rub = (k: number) => `${Math.trunc(k / 100)}${k % 100 ? `,${String(k % 100).padStart(2, '0')}` : ''}`;
  const p: Record<string, string> = {};
  if (f.q) p.q = f.q;
  if (f.categoryId) p.category = String(f.categoryId);
  if (f.brandId) p.brand = String(f.brandId);
  if (f.availability) p.availability = f.availability;
  if (f.published !== undefined) p.published = f.published ? '1' : '0';
  if (f.hidden !== undefined) p.hidden = f.hidden ? '1' : '0';
  if (f.priceMinKopecks !== undefined) p.priceMin = rub(f.priceMinKopecks);
  if (f.priceMaxKopecks !== undefined) p.priceMax = rub(f.priceMaxKopecks);
  if (f.isNew) p.new = '1';
  if (f.featured) p.featured = '1';
  if (f.isPromo) p.promo = '1';
  return p;
}

/** Только условия отбора из полного запроса (без страницы/сортировки). */
export function filterOf(q: ProductFilter): ProductFilter {
  const { q: text, categoryId, brandId, availability, published, hidden, priceMinKopecks, priceMaxKopecks, isNew, featured, isPromo } = q;
  return Object.fromEntries(
    Object.entries({ q: text, categoryId, brandId, availability, published, hidden, priceMinKopecks, priceMaxKopecks, isNew, featured, isPromo }).filter(([, v]) => v !== undefined),
  ) as ProductFilter;
}

type Arg = string | number;

function whereOf(db: Db, f: ProductFilter): { where: string; args: Arg[] } {
  const where: string[] = [];
  const args: Arg[] = [];
  if (f.q) {
    const like = `%${foldText(f.q).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push("(rts_fold(p.name) LIKE ? ESCAPE '\\' OR rts_fold(COALESCE(p.sku, '')) LIKE ? ESCAPE '\\' OR COALESCE(p.barcode, '') LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  if (f.categoryId !== undefined) {
    // категория вместе с подкатегориями; основная и дополнительные (product_categories)
    const ids = descendantIds(categoriesRepo.listAll(db), f.categoryId);
    where.push(IN_CATEGORIES);
    args.push(JSON.stringify(ids));
  }
  if (f.brandId !== undefined) {
    where.push('p.brand_id = ?');
    args.push(f.brandId);
  }
  if (f.availability !== undefined) {
    where.push('p.availability = ?');
    args.push(f.availability);
  }
  if (f.published !== undefined) {
    where.push('p.published = ?');
    args.push(f.published ? 1 : 0);
  }
  if (f.hidden !== undefined) {
    where.push('p.hidden_by_admin = ?');
    args.push(f.hidden ? 1 : 0);
  }
  if (f.priceMinKopecks !== undefined) {
    where.push(`${EFFECTIVE_PRICE} >= ?`);
    args.push(f.priceMinKopecks);
  }
  if (f.priceMaxKopecks !== undefined) {
    where.push(`${EFFECTIVE_PRICE} <= ?`);
    args.push(f.priceMaxKopecks);
  }
  if (f.isNew) where.push('p.is_new = 1');
  if (f.featured) where.push('p.featured = 1');
  if (f.isPromo) where.push('p.is_promo = 1');
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

const FROM = 'FROM products p JOIN categories c ON c.id = p.category_id';

const ORDER: Record<ProductSort, string> = {
  name: 'rts_fold(p.name)',
  price: EFFECTIVE_PRICE,
  date: 'p.updated_at',
  stock: 'p.stock_qty',
  category: 'rts_fold(c.name)',
};

export type ProductListItem = {
  id: number;
  name: string;
  shortDescription: string | null;
  sku: string | null;
  categoryId: number;
  categoryName: string;
  priceKopecks: number;
  discountPriceKopecks: number | null;
  oldPriceKopecks: number | null;
  stockQty: number;
  stockTracked: boolean;
  availability: ProductAvailability;
  published: boolean;
  hidden: boolean;
  featured: boolean;
  isNew: boolean;
  isPromo: boolean;
  updatedAt: string;
  image: { src: string; alt: string } | null;
};

export type ProductListResult = { items: ProductListItem[]; total: number; page: number; pageSize: number };

type ItemRaw = {
  id: number;
  name: string;
  short_description: string | null;
  sku: string | null;
  category_id: number;
  category_name: string;
  price_kopecks: number;
  discount_price_kopecks: number | null;
  old_price_kopecks: number | null;
  stock_qty: number;
  stock_tracked: number;
  availability: ProductAvailability;
  published: number;
  hidden_by_admin: number;
  featured: number;
  is_new: number;
  is_promo: number;
  updated_at: string;
  img_url: string | null;
  img_path: string | null;
  img_variants: string | null;
  img_alt: string | null;
};

/**
 * Страница списка: 1) число под отбор, 2) id страницы по индексам/сортировке, 3) данные именно этих строк (с первым фото
 * через индекс product_images(product_id, sort) — таблица фото целиком не читается). Категории читаются только при фильтре по категории.
 */
export function listProducts(db: Db, query: ProductListQuery): ProductListResult {
  ensureFold(db);
  const { where, args } = whereOf(db, query);
  const total = Number((db.prepare(`SELECT COUNT(*) AS n ${FROM} ${where}`).get(...args) as { n: number }).n);
  const pageSize = query.pageSize;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, pages);
  const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
  const ids = (
    db.prepare(`SELECT p.id ${FROM} ${where} ORDER BY ${ORDER[query.sort]} ${dir}, p.id ${dir} LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as { id: number }[]
  ).map((r) => r.id);
  if (ids.length === 0) return { items: [], total, page, pageSize };
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.short_description, p.sku, p.category_id, c.name AS category_name, p.price_kopecks, p.discount_price_kopecks, p.old_price_kopecks,
         p.stock_qty, p.stock_tracked, p.availability, p.published, p.hidden_by_admin, p.featured, p.is_new, p.is_promo, p.updated_at,
         i.url_source AS img_url, i.path AS img_path, i.variants AS img_variants, i.alt AS img_alt
       FROM products p JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_images i ON i.id = (SELECT i2.id FROM product_images i2 WHERE i2.product_id = p.id ORDER BY i2.sort, i2.id LIMIT 1)
       WHERE p.id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(ids)) as ItemRaw[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const image = r.img_url
      ? (() => {
          const img = toCatalogImage({ path: r.img_path, variants: parseVariants(r.img_variants), urlSource: r.img_url, alt: r.img_alt }, 'thumb', r.name);
          return { src: img.src, alt: img.alt };
        })()
      : null;
    return [
      {
        id: r.id,
        name: r.name,
        shortDescription: r.short_description,
        sku: r.sku,
        categoryId: r.category_id,
        categoryName: r.category_name,
        priceKopecks: r.price_kopecks,
        discountPriceKopecks: r.discount_price_kopecks,
        oldPriceKopecks: r.old_price_kopecks,
        stockQty: r.stock_qty,
        stockTracked: r.stock_tracked === 1,
        availability: r.availability,
        published: r.published === 1,
        hidden: r.hidden_by_admin === 1,
        featured: r.featured === 1,
        isNew: r.is_new === 1,
        isPromo: r.is_promo === 1,
        updatedAt: r.updated_at,
        image,
      },
    ];
  });
  return { items, total, page, pageSize };
}

/** Сколько товаров под отбор. */
export function countProducts(db: Db, f: ProductFilter): number {
  ensureFold(db);
  const { where, args } = whereOf(db, f);
  return Number((db.prepare(`SELECT COUNT(*) AS n ${FROM} ${where}`).get(...args) as { n: number }).n);
}

/** id под отбор (для «все по фильтру»), по возрастанию, не больше limit. */
export function selectProductIds(db: Db, f: ProductFilter, limit: number): number[] {
  ensureFold(db);
  const { where, args } = whereOf(db, f);
  return (db.prepare(`SELECT p.id ${FROM} ${where} ORDER BY p.id LIMIT ?`).all(...args, limit) as { id: number }[]).map((r) => r.id);
}

export type ExportRow = {
  id: number;
  sku: string | null;
  name: string;
  categoryName: string;
  brandName: string | null;
  priceKopecks: number;
  oldPriceKopecks: number | null;
  stockQty: number;
  availability: ProductAvailability;
  published: boolean;
  hidden: boolean;
  slug: string;
  purchasePriceKopecks: number | null;
};

/** Порция выгрузки: товары под отбор с id > afterId по возрастанию id (ключевая пагинация, без OFFSET). */
export function exportBatch(db: Db, f: ProductFilter, afterId: number, size: number): ExportRow[] {
  ensureFold(db);
  const { where, args } = whereOf(db, f);
  const cond = where ? `${where} AND p.id > ?` : 'WHERE p.id > ?';
  const rows = db
    .prepare(
      `SELECT p.id, p.sku, p.name, c.name AS category_name, b.name AS brand_name, p.price_kopecks, p.old_price_kopecks, p.stock_qty, p.availability,
         p.published, p.hidden_by_admin, p.slug, p.purchase_price_kopecks
       ${FROM} LEFT JOIN brands b ON b.id = p.brand_id ${cond} ORDER BY p.id LIMIT ?`,
    )
    .all(...args, afterId, size) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    id: Number(r.id),
    sku: r.sku === null ? null : String(r.sku),
    name: String(r.name),
    categoryName: String(r.category_name),
    brandName: r.brand_name === null ? null : String(r.brand_name),
    priceKopecks: Number(r.price_kopecks),
    oldPriceKopecks: r.old_price_kopecks === null ? null : Number(r.old_price_kopecks),
    stockQty: Number(r.stock_qty),
    availability: String(r.availability) as ProductAvailability,
    published: r.published === 1,
    hidden: r.hidden_by_admin === 1,
    slug: String(r.slug),
    purchasePriceKopecks: r.purchase_price_kopecks === null ? null : Number(r.purchase_price_kopecks),
  }));
}

/** Копейки → «1234,50» без плавающей точки. */
export const rublesText = (kopecks: number): string => `${Math.trunc(kopecks / 100)},${String(Math.abs(kopecks) % 100).padStart(2, '0')}`;

/** Ячейка CSV: кавычки удваиваются; значения, похожие на формулу (= + - @ табуляция), обезврежены апострофом. */
export function csvCell(v: string | number | null): string {
  let t = v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export const CSV_BOM = '﻿';

export function exportHeader(withCost: boolean): string {
  const head = ['id', 'артикул', 'название', 'категория', 'бренд', 'цена', 'старая цена', 'остаток', 'наличие', 'публикация', 'slug'];
  if (withCost) head.push('закупочная цена');
  return head.map(csvCell).join(';') + '\r\n';
}

export function exportLine(r: ExportRow, withCost: boolean): string {
  const cells: (string | number | null)[] = [
    r.id,
    r.sku,
    r.name,
    r.categoryName,
    r.brandName,
    rublesText(r.priceKopecks),
    r.oldPriceKopecks === null ? null : rublesText(r.oldPriceKopecks),
    r.stockQty,
    AVAILABILITY_LABELS[r.availability] ?? r.availability,
    r.hidden ? 'скрыт' : r.published ? 'опубликован' : 'снят с публикации',
    r.slug,
  ];
  if (withCost) cells.push(r.purchasePriceKopecks === null ? null : rublesText(r.purchasePriceKopecks));
  return cells.map(csvCell).join(';') + '\r\n';
}
