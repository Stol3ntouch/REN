import type { Db } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { imagesRepo } from '@/server/db/repositories/images';
import { productsRepo, type ProductRow } from '@/server/db/repositories/products';
import { slugify, uniqueSlug } from './slug';
import { YML_SOURCE, type ImportPlan, type LockableField, type ParsedCategory, type ParsedOffer, type ParsedYml, type PlannedCategory, type PlannedProduct, type RowError } from './types';

export type ProductDiff = {
  /** Поля, которые импорт изменит. */
  changes: LockableField[];
  /** Поля, где файл отличается, но они закреплены в locked_fields. */
  lockedSkipped: LockableField[];
};

/** Сравнивает сохранённый товар с данными из файла. Единая логика для предпросмотра и применения. */
export function diffProduct(db: Db, existing: ProductRow, offer: ParsedOffer, opts: { overrideLocked?: boolean } = {}): ProductDiff {
  const differing: LockableField[] = [];
  if (existing.name !== offer.name) differing.push('name');
  if ((existing.sku ?? null) !== offer.sku) differing.push('sku');
  if ((existing.description ?? null) !== offer.description) differing.push('description');
  if (existing.categoryExternalId !== offer.categoryExternalId) differing.push('category');
  if (existing.priceKopecks !== offer.priceKopecks) differing.push('price');
  if (existing.inStock !== offer.inStock) differing.push('in_stock');
  const storedAttrs = JSON.stringify(attributesRepo.listByProduct(db, existing.id).map((a) => [a.name, a.value]));
  if (storedAttrs !== JSON.stringify(offer.attributes.map((a) => [a.name, a.value]))) differing.push('attributes');
  const storedUrls = JSON.stringify(imagesRepo.listByProduct(db, existing.id).map((i) => i.urlSource));
  if (storedUrls !== JSON.stringify(offer.pictures)) differing.push('images');

  const locked = new Set(opts.overrideLocked ? [] : existing.lockedFields);
  return {
    changes: differing.filter((f) => !locked.has(f)),
    lockedSkipped: differing.filter((f) => locked.has(f)),
  };
}

/** Базовый slug товара: последний сегмент <url>, иначе транслитерация названия. */
export function productSlugBase(offer: Pick<ParsedOffer, 'slugHint' | 'name'>): string {
  return slugify(offer.slugHint ?? '') || slugify(offer.name);
}

export function categorySlugBase(cat: Pick<ParsedCategory, 'name'>): string {
  return slugify(cat.name);
}

/**
 * Предпросмотр импорта: что будет создано, обновлено, пропущено и какие строки с ошибками. В БД ничего не пишет.
 */
export function planImport(parsed: ParsedYml, db: Db, opts: { fileName?: string | null; now?: Date; mode?: 'create_only' | 'update'; overrideLocked?: boolean } = {}): ImportPlan {
  const errors: RowError[] = [...parsed.errors];

  // Категории
  const dbCategories = categoriesRepo.listAll(db).filter((c) => c.source === YML_SOURCE);
  const externalById = new Map(dbCategories.map((c) => [c.id, c.externalId]));
  const takenCategorySlugs = categoriesRepo.allSlugs(db);
  const plannedCategories: PlannedCategory[] = parsed.categories.map((cat) => {
    const existing = categoriesRepo.findByExternalId(db, YML_SOURCE, cat.externalId);
    if (!existing) {
      const slug = uniqueSlug(categorySlugBase(cat), cat.externalId, takenCategorySlugs);
      return { action: 'create', externalId: cat.externalId, name: cat.name, slug, changes: [], data: cat };
    }
    const changes: string[] = [];
    if (existing.name !== cat.name) changes.push('name');
    const currentParent = existing.parentId === null ? null : (externalById.get(existing.parentId) ?? null);
    if (currentParent !== cat.parentExternalId) changes.push('parent');
    return { action: changes.length > 0 ? 'update' : 'unchanged', externalId: cat.externalId, name: cat.name, slug: existing.slug, changes, data: cat };
  });

  // Товары
  const knownCategories = new Set([...dbCategories.map((c) => c.externalId), ...parsed.categories.map((c) => c.externalId)]);
  const takenProductSlugs = productsRepo.allSlugs(db);
  const plannedProducts: PlannedProduct[] = [];
  for (const offer of parsed.offers) {
    if (!knownCategories.has(offer.categoryExternalId)) {
      errors.push({ kind: 'offer', externalId: offer.externalId, position: offer.position, message: `Товар ${offer.externalId}: категория ${offer.categoryExternalId} не найдена в файле и в каталоге` });
      continue;
    }
    const existing = productsRepo.findByExternalId(db, YML_SOURCE, offer.externalId);
    if (!existing) {
      const slug = uniqueSlug(productSlugBase(offer), offer.externalId, takenProductSlugs);
      plannedProducts.push({ action: 'create', externalId: offer.externalId, name: offer.name, slug, changes: [], lockedSkipped: [], data: offer });
      continue;
    }
    if (opts.mode === 'create_only') {
      plannedProducts.push({ action: 'unchanged', externalId: offer.externalId, name: offer.name, slug: existing.slug, changes: [], lockedSkipped: [], data: offer });
      continue;
    }
    const diff = diffProduct(db, existing, offer, { overrideLocked: opts.overrideLocked });
    plannedProducts.push({
      action: diff.changes.length > 0 ? 'update' : 'unchanged',
      externalId: offer.externalId,
      name: offer.name,
      slug: existing.slug,
      changes: diff.changes,
      lockedSkipped: diff.lockedSkipped,
      data: offer,
    });
  }

  const count = <T extends { action: string }>(items: T[], action: string) => items.filter((i) => i.action === action).length;
  return {
    fileName: opts.fileName ?? null,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    categories: plannedCategories,
    products: plannedProducts,
    errors,
    summary: {
      categories: { create: count(plannedCategories, 'create'), update: count(plannedCategories, 'update'), unchanged: count(plannedCategories, 'unchanged') },
      products: { create: count(plannedProducts, 'create'), update: count(plannedProducts, 'update'), unchanged: count(plannedProducts, 'unchanged') },
      errors: errors.length,
    },
  };
}
