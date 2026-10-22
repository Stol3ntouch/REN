import { attributesRepo } from '@/server/db/repositories/attributes';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { imagesRepo } from '@/server/db/repositories/images';
import { productsRepo } from '@/server/db/repositories/products';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';

export { createTestDb };

const NOW = '2026-10-22T10:00:00.000Z';
let seq = 0;

export function addCategory(db: Db, name: string, slug: string, parentId: number | null = null): number {
  seq += 1;
  return categoriesRepo.insert(db, { source: 'yml', externalId: `c${seq}-${slug}`, parentId, name, slug, sort: seq });
}

export type ProductSpec = {
  name: string;
  slug?: string;
  sku?: string | null;
  categoryId: number;
  priceRub?: number;
  discountRub?: number;
  inStock?: boolean;
  published?: boolean;
  attrs?: Record<string, string>;
  images?: string[];
  description?: string | null;
};

export function addProduct(db: Db, spec: ProductSpec): number {
  seq += 1;
  const id = productsRepo.insert(db, {
    source: 'yml',
    externalId: `p${seq}`,
    sku: spec.sku === undefined ? `SKU${seq}` : spec.sku,
    name: spec.name,
    slug: spec.slug ?? `tovar-${seq}`,
    description: spec.description ?? null,
    categoryId: spec.categoryId,
    priceKopecks: Math.round((spec.priceRub ?? 1000) * 100),
    inStock: spec.inStock ?? true,
    now: NOW,
  });
  if (spec.discountRub !== undefined) db.prepare('UPDATE products SET discount_price_kopecks = ? WHERE id = ?').run(Math.round(spec.discountRub * 100), id);
  if (spec.published === false) db.prepare('UPDATE products SET published = 0 WHERE id = ?').run(id);
  if (spec.attrs) attributesRepo.replaceForProduct(db, id, Object.entries(spec.attrs).map(([name, value]) => ({ name, value })));
  if (spec.images) imagesRepo.replaceForProduct(db, id, spec.images, spec.name);
  return id;
}

export function attributeId(db: Db, name: string): string {
  const r = db.prepare('SELECT id FROM attribute_definitions WHERE name = ?').get(name) as { id: number };
  return String(r.id);
}

/** Пустая выборка по умолчанию. */
export const baseQuery = { filters: {}, sort: 'name' as const, page: 1 };
