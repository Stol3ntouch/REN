import { getDb, type Db } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { sanitizeDescription } from '@/importing/yml/sanitize';
import { imagesRepo } from '@/server/db/repositories/images';
import { productsRepo, visibleProductSql } from '@/server/db/repositories/products';
import { listCategoryRows } from './category-rows';
import { getCategoryBreadcrumbs, toCategoryInfo } from './categories';
import { toCatalogImage } from './images';
import { CARD_COLUMNS, CARD_JOIN, ensureFold, mapCard, unitPrice, type CardRow } from './store';
import type { ProductCard, ProductPage } from './types';

export const RELATED_LIMIT = 8;
/** Блок «сопутствующие» показывается, только если есть хотя бы столько товаров. */
export const RELATED_MIN = 2;

/** Страница товара; неопубликованный или неизвестный slug — null. */
export async function getProductBySlug(slug: string, opts: { db?: Db } = {}): Promise<ProductPage | null> {
  const db = opts.db ?? getDb();
  const p = productsRepo.findBySlug(db, slug);
  if (!p || !p.published || p.hiddenByAdmin) return null;
  const category = listCategoryRows(db).find((c) => c.id === p.categoryId);
  if (!category) return null;

  const rows = imagesRepo.listByProduct(db, p.id);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    sku: p.sku,
    // Описание в БД может прийти не только из импорта: очищаем на выводе (белый список тегов без атрибутов).
    descriptionHtml: p.description && p.description.trim() !== '' ? sanitizeDescription(p.description) : null,
    ...unitPrice(p.priceKopecks, p.discountPriceKopecks),
    inStock: p.inStock,
    category: toCategoryInfo(category),
    breadcrumbs: await getCategoryBreadcrumbs(category.slug, { db }),
    images: rows.map((r) => toCatalogImage(r, 'large', p.name)),
    thumbs: rows.map((r) => toCatalogImage(r, 'thumb', p.name)),
    attributes: attributesRepo.listByProduct(db, p.id),
  };
}

/**
 * Сопутствующие: другие опубликованные товары той же категории (связей в YML нет),
 * в наличии — выше, дальше по алфавиту и id. Меньше двух — пусто: блок скрывается.
 */
export async function getRelatedProducts(productId: number, opts: { db?: Db } = {}): Promise<ProductCard[]> {
  const db = opts.db ?? getDb();
  ensureFold(db);
  const rows = db
    .prepare(
      `SELECT ${CARD_COLUMNS} FROM products p ${CARD_JOIN}
       WHERE ${visibleProductSql('p')} AND p.id <> ? AND p.category_id = (SELECT category_id FROM products WHERE id = ?)
       ORDER BY p.in_stock DESC, rts_fold(p.name), p.id LIMIT ?`,
    )
    .all(productId, productId, RELATED_LIMIT) as CardRow[];
  return rows.length < RELATED_MIN ? [] : rows.map(mapCard);
}
