import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { audit } from '@/domain/admin/audit';
import { hasPermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { appliesToCategory, ancestorsOf, coerceValue } from '@/domain/catalog/attributes';
import { clearCategoryImageCache } from '@/domain/catalog/category-images';
import { priceRules, parseProductInput, productSlugFrom, type AvailabilityChoice, type ProductInput, type ProductParsed } from '@/domain/catalog/products-admin';
import { stock } from '@/domain/catalog/stock';
import { sanitizeDescription } from '@/importing/yml/sanitize';
import { defaultUploadsDir, ImageStoreError, storeImage, type StoredImage } from '@/media/store-image';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { attributesRepo, type AttributeDef } from '@/server/db/repositories/attributes';
import { brandsRepo } from '@/server/db/repositories/brands';
import { categoriesRepo } from '@/server/db/repositories/categories';
import type { ImageRow } from '@/server/db/repositories/images';
import { productCategoriesRepo } from '@/server/db/repositories/product-categories';
import { productMediaRepo } from '@/server/db/repositories/product-media';
import { productsAdminRepo, type ProductColumns, type ProductDependencies, type ProductFull } from '@/server/db/repositories/products-admin';
import { stockRepo, isSellable, type Availability } from '@/server/db/repositories/stock';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number; uploadsDir?: string };

export const MAX_IMAGES_PER_UPLOAD = 20;
export const MAX_IMAGES_PER_PRODUCT = 30;
export const MAX_IMAGE_ALT = 200;

const READ: readonly Permission[] = ['products.read', 'catalog.read'];
const WRITE: readonly Permission[] = ['products.write', 'catalog.write'];

function requireAny(session: StaffSession | null | undefined, perms: readonly Permission[]): asserts session is StaffSession {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!perms.some((p) => hasPermission(session, p))) throw new ForbiddenError('Недостаточно прав для этого действия');
}

const iso = (now: number) => new Date(now).toISOString();

/** Закупочная цена: видна и сохраняется только с правом products.cost. */
export function canViewCost(session: StaffSession | null | undefined): boolean {
  return !!session && hasPermission(session, 'products.cost');
}

export type ProductForm = {
  id: number;
  source: string;
  name: string;
  slug: string;
  sku: string | null;
  barcode: string | null;
  shortDescription: string | null;
  description: string | null;
  categoryId: number;
  categoryName: string;
  extraCategoryIds: number[];
  brandId: number | null;
  priceKopecks: number;
  discountPriceKopecks: number | null;
  oldPriceKopecks: number | null;
  /** Есть в объекте только при праве products.cost. */
  purchasePriceKopecks?: number | null;
  availability: Availability;
  availabilityMode: 'auto' | 'manual';
  stock: { stockQty: number; reservedQty: number; availableQty: number; tracked: boolean };
  published: boolean;
  hidden: boolean;
  featured: boolean;
  isNew: boolean;
  isPromo: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  indexable: boolean;
  attributes: { attributeId: number; value: string }[];
  images: ImageRow[];
  lockedFields: string[];
  createdAt: string | null;
  createdBy: number | null;
  updatedAt: string;
};

/** Поля, по которым сравнивается «до/после» (для журнала и списка изменений). Закупочной здесь нет. */
type Snap = {
  name: string;
  slug: string;
  sku: string | null;
  barcode: string | null;
  shortDescription: string | null;
  description: string | null;
  categoryId: number;
  extraCategoryIds: number[];
  brandId: number | null;
  priceKopecks: number;
  discountPriceKopecks: number | null;
  oldPriceKopecks: number | null;
  availability: AvailabilityChoice;
  published: boolean;
  hidden: boolean;
  featured: boolean;
  isNew: boolean;
  isPromo: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  indexable: boolean;
};

/** Какие поля закрепляются за ручной правкой, чтобы импорт YML их не перезаписывал (locked_fields). */
const LOCK_FOR: Partial<Record<keyof Snap | 'attributes' | 'stock' | 'images', string>> = {
  name: 'name',
  sku: 'sku',
  description: 'description',
  categoryId: 'category',
  priceKopecks: 'price',
  discountPriceKopecks: 'discount_price',
  published: 'published',
  featured: 'featured',
  seoTitle: 'seo_title',
  seoDescription: 'seo_description',
  attributes: 'attributes',
  brandId: 'brand',
  barcode: 'barcode',
  oldPriceKopecks: 'old_price',
  shortDescription: 'short_description',
  isNew: 'flags',
  isPromo: 'flags',
  availability: 'in_stock',
  stock: 'in_stock',
  images: 'images',
};

function snapOf(p: ProductFull, extra: number[]): Snap {
  return {
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    barcode: p.barcode,
    shortDescription: p.shortDescription,
    description: p.description,
    categoryId: p.categoryId,
    extraCategoryIds: [...extra].sort((a, b) => a - b),
    brandId: p.brandId,
    priceKopecks: p.priceKopecks,
    discountPriceKopecks: p.discountPriceKopecks,
    oldPriceKopecks: p.oldPriceKopecks,
    availability: p.availabilityManual ? p.availability : 'auto',
    published: p.published,
    hidden: p.hiddenByAdmin,
    featured: p.featured,
    isNew: p.isNew,
    isPromo: p.isPromo,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    canonicalUrl: p.canonicalUrl,
    indexable: p.indexable,
  };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function addLocks(current: string[], changed: readonly string[]): string[] {
  const out = new Set(current);
  for (const k of changed) {
    const l = LOCK_FOR[k as keyof typeof LOCK_FOR];
    if (l) out.add(l);
  }
  return [...out];
}

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, { [field]: [message] });
}

/** Характеристики → записи для сохранения; проверка типа, допустимых значений и обязательности. */
function resolveAttributes(
  db: Db,
  provided: readonly { attributeId: number; value: string }[] | undefined,
  categoryIds: readonly number[],
  stored: ReadonlyMap<number, string>,
  checkRequired: boolean,
): { write: { attributeId: number; text: string; num: number | null }[]; remove: number[]; before: Record<string, string | null>; after: Record<string, string | null> } {
  const write: { attributeId: number; text: string; num: number | null }[] = [];
  const remove: number[] = [];
  const before: Record<string, string | null> = {};
  const after: Record<string, string | null> = {};
  const seen = new Set<number>();
  const finalValues = new Map(stored);

  for (const item of provided ?? []) {
    if (seen.has(item.attributeId)) throw fieldError('attributes', 'Характеристика указана дважды');
    seen.add(item.attributeId);
    const def = attributesRepo.findById(db, item.attributeId);
    if (!def) throw fieldError('attributes', `Характеристика №${item.attributeId} не найдена`);
    const raw = item.value.trim();
    const prev = stored.get(item.attributeId) ?? null;
    if (raw === '') {
      if (def.required) throw fieldError('attributes', `«${def.name}»: обязательная характеристика, заполните значение`);
      if (prev !== null) {
        remove.push(def.id);
        before[def.name] = prev;
        after[def.name] = null;
        finalValues.delete(def.id);
      }
      continue;
    }
    const r = coerceValue(def.type, raw, def.allowedValues);
    if (!r.ok) throw fieldError('attributes', `«${def.name}»: ${r.error}`);
    finalValues.set(def.id, r.value.text);
    if (prev !== r.value.text) {
      write.push({ attributeId: def.id, text: r.value.text, num: r.value.num });
      before[def.name] = prev;
      after[def.name] = r.value.text;
    }
  }

  if (checkRequired) {
    const parents = new Map(categoriesRepo.listAll(db).map((c) => [c.id, c.parentId]));
    const chain = new Set<number>();
    for (const c of categoryIds) for (const a of ancestorsOf(c, parents)) chain.add(a);
    for (const d of attributesRepo.listAll(db)) {
      if (!d.required || finalValues.has(d.id)) continue;
      const full = attributesRepo.findById(db, d.id) as AttributeDef;
      if (appliesToCategory(full.categoryIds, chain)) throw fieldError('attributes', `«${d.name}»: обязательная характеристика, заполните значение`);
    }
  }
  return { write, remove, before, after };
}

function storedAttributes(db: Db, productId: number): Map<number, string> {
  return new Map(attributesRepo.valuesOfProduct(db, productId).map((a) => [a.attributeId, a.value]));
}

/** Категории и бренд существуют. */
function assertRefs(db: Db, categoryId: number, extra: readonly number[], brandId: number | null | undefined): void {
  const ok = productCategoriesRepo.existing(db, [categoryId, ...extra]);
  if (!ok.has(categoryId)) throw fieldError('categoryId', 'Выбранная категория не найдена');
  for (const e of extra) if (!ok.has(e)) throw fieldError('extraCategoryIds', 'Дополнительная категория не найдена');
  if (brandId != null && !brandsRepo.findById(db, brandId)) throw fieldError('brandId', 'Выбранный бренд не найден');
}

function cleanDescription(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v.trim() === '') return null;
  return sanitizeDescription(v);
}

function uniqueExtra(extra: readonly number[] | undefined, primary: number): number[] {
  return [...new Set(extra ?? [])].filter((e) => e !== primary);
}

function toForm(db: Db, p: ProductFull, canCost: boolean): ProductForm {
  const form: ProductForm = {
    id: p.id,
    source: p.source,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    barcode: p.barcode,
    shortDescription: p.shortDescription,
    description: p.description,
    categoryId: p.categoryId,
    categoryName: p.categoryName,
    extraCategoryIds: productCategoriesRepo.listExtra(db, p.id),
    brandId: p.brandId,
    priceKopecks: p.priceKopecks,
    discountPriceKopecks: p.discountPriceKopecks,
    oldPriceKopecks: p.oldPriceKopecks,
    availability: p.availability,
    availabilityMode: p.availabilityManual ? 'manual' : 'auto',
    stock: { stockQty: p.stockQty, reservedQty: p.reservedQty, availableQty: p.stockQty - p.reservedQty, tracked: p.stockTracked },
    published: p.published,
    hidden: p.hiddenByAdmin,
    featured: p.featured,
    isNew: p.isNew,
    isPromo: p.isPromo,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    canonicalUrl: p.canonicalUrl,
    indexable: p.indexable,
    attributes: attributesRepo.valuesOfProduct(db, p.id),
    images: productMediaRepo.list(db, p.id),
    lockedFields: p.lockedFields,
    createdAt: p.createdAt,
    createdBy: p.createdBy,
    updatedAt: p.updatedAt,
  };
  if (canCost) form.purchasePriceKopecks = p.purchasePriceKopecks;
  return form;
}

function mustFind(db: Db, id: number): ProductFull {
  const p = productsAdminRepo.findById(db, id);
  if (!p) throw new NotFoundError('Товар не найден');
  return p;
}

/** Пустой остаток при создании не нужен: остаток и резерв пишутся через stock.adjust, если указаны. */
function applyStock(db: Db, session: StaffSession, productId: number, cur: { stockQty: number; reservedQty: number }, data: ProductParsed, now: number, creating: boolean): boolean {
  if (data.stockQty === undefined && data.reservedQty === undefined) return false;
  const stockQty = data.stockQty ?? cur.stockQty;
  const reservedQty = data.reservedQty ?? cur.reservedQty;
  if (stockQty === cur.stockQty && reservedQty === cur.reservedQty) return false;
  const reason = data.stockReason?.trim() || (creating ? 'Начальный остаток' : '');
  const res = stock.adjust(productId, { set: stockQty, reserved: reservedQty }, reason, { staffId: session.staffId }, { db, now });
  return res.changed;
}

function applyAvailability(db: Db, id: number, choice: AvailabilityChoice): void {
  if (choice !== 'auto') {
    stockRepo.saveAvailability(db, id, { availability: choice, manual: true });
    return;
  }
  const row = stockRepo.get(db, id) as NonNullable<ReturnType<typeof stockRepo.get>>;
  const availability: Availability = row.tracked ? (row.stockQty - row.reservedQty > 0 ? 'in_stock' : 'out_of_stock') : row.inStock ? 'in_stock' : 'out_of_stock';
  stockRepo.saveAvailability(db, id, { availability, manual: false });
}

/** Состав записи для журнала: без закупочной цены. */
function auditSnapshot(p: ProductFull, extra: number[]): Snap {
  return snapOf(p, extra);
}

export const productOps = {
  canViewCost,

  /** Карточка товара для формы. Закупочная цена включается только при праве products.cost. */
  get(session: StaffSession | null, id: number, opts: Opts = {}): ProductForm | null {
    requireAny(session, READ);
    const db = opts.db ?? getDb();
    const p = productsAdminRepo.findById(db, id);
    return p ? toForm(db, p, canViewCost(session)) : null;
  },

  /** Справочники формы: категории (с путём), бренды, характеристики с определениями. */
  formOptions(session: StaffSession | null, opts: Opts = {}) {
    requireAny(session, READ);
    const db = opts.db ?? getDb();
    const cats = categoriesRepo.listAll(db);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const pathOf = (id: number): string => {
      const names: string[] = [];
      const seen = new Set<number>();
      for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) {
        seen.add(cur.id);
        names.unshift(cur.name);
      }
      return names.join(' / ');
    };
    const categories = cats.map((c) => ({ id: c.id, label: pathOf(c.id), parentId: c.parentId })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    const brands = brandsRepo.listAll(db).map((b) => ({ id: b.id, name: b.name }));
    const attributes = attributesRepo.listAll(db).map((d) => attributesRepo.findById(db, d.id) as AttributeDef);
    return { categories, brands, attributes };
  },

  /** Свободный slug по названию (для подсказки в форме). exceptId — собственный товар, его slug считается свободным. */
  suggestSlug(session: StaffSession | null, name: string, exceptId?: number, opts: Opts = {}): string {
    requireAny(session, READ);
    const db = opts.db ?? getDb();
    const taken = productsAdminRepo.allSlugs(db);
    if (exceptId !== undefined) {
      const own = productsAdminRepo.findById(db, exceptId);
      if (own) taken.delete(own.slug);
    }
    return productSlugFrom(name, taken);
  },

  dependencies(session: StaffSession | null, id: number, opts: Opts = {}): ProductDependencies {
    requireAny(session, READ);
    return productsAdminRepo.dependencies(opts.db ?? getDb(), id);
  },

  async create(session: StaffSession | null, input: ProductInput, opts: Opts = {}): Promise<{ id: number; slug: string }> {
    requireAny(session, WRITE);
    const data = parseProductInput(input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const cost = canViewCost(session);

    return withTransaction(db, () => {
      const extra = uniqueExtra(data.extraCategoryIds, data.categoryId);
      assertRefs(db, data.categoryId, extra, data.brandId);

      let slug = data.slug ?? '';
      if (slug !== '') {
        if (productsAdminRepo.slugOwner(db, slug) !== null) throw new ConflictError('Slug уже занят другим товаром');
      } else {
        slug = productSlugFrom(data.name, productsAdminRepo.allSlugs(db));
      }
      const sku = data.sku ?? null;
      if (sku !== null && productsAdminRepo.skuOwner(db, 'manual', sku) !== null) throw new ConflictError('Товар с таким артикулом уже есть');

      const attrs = resolveAttributes(db, data.attributes, [data.categoryId, ...extra], new Map(), true);
      const description = cleanDescription(data.description) ?? null;

      const id = productsAdminRepo.insertManual(db, {
        externalId: `manual-${randomUUID()}`,
        sku,
        barcode: data.barcode ?? null,
        name: data.name,
        slug,
        shortDescription: data.shortDescription ?? null,
        description,
        categoryId: data.categoryId,
        brandId: data.brandId ?? null,
        priceKopecks: data.priceKopecks,
        discountPriceKopecks: data.discountPriceKopecks ?? null,
        oldPriceKopecks: data.oldPriceKopecks ?? null,
        purchasePriceKopecks: cost ? (data.purchasePriceKopecks ?? null) : null,
        published: data.published ?? true,
        hiddenByAdmin: data.hidden ?? false,
        featured: data.featured ?? false,
        isNew: data.isNew ?? false,
        isPromo: data.isPromo ?? false,
        canonicalUrl: data.canonicalUrl ?? null,
        indexable: data.indexable ?? true,
        createdBy: session.staffId,
        now: iso(now),
      });
      productCategoriesRepo.setExtra(db, id, data.categoryId, extra);
      if (data.seoTitle != null || data.seoDescription != null) productsAdminRepo.upsertSeo(db, id, { title: data.seoTitle ?? null, description: data.seoDescription ?? null }, now);
      for (const w of attrs.write) attributesRepo.setProductValue(db, id, w.attributeId, w.text, w.num);
      applyStock(db, session, id, { stockQty: 0, reservedQty: 0 }, data, now, true);
      if (data.availability !== undefined && data.availability !== 'auto') applyAvailability(db, id, data.availability);

      const created = mustFind(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'product.create', entity: 'product', entityId: id, after: auditSnapshot(created, extra) }, { db, now });
      clearCategoryImageCache();
      return { id, slug };
    });
  },

  /**
   * Правка карточки. Не указанные поля остаются как были. Закрепляет изменённые поля за ручной правкой (locked_fields),
   * пишет в журнал только изменённое (до/после; закупочная — отметкой без значений). Остаток меняется только через stock.adjust.
   */
  async update(session: StaffSession | null, id: number, input: ProductInput, opts: Opts = {}): Promise<{ changed: string[] }> {
    requireAny(session, WRITE);
    const data = parseProductInput(input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const cost = canViewCost(session);

    const result = withTransaction(db, () => {
      const cur = mustFind(db, id);
      const curExtra = productCategoriesRepo.listExtra(db, id);
      const before = snapOf(cur, curExtra);

      const discount = data.discountPriceKopecks !== undefined ? data.discountPriceKopecks : cur.discountPriceKopecks;
      const old = data.oldPriceKopecks !== undefined ? data.oldPriceKopecks : cur.oldPriceKopecks;
      const priceErrors = priceRules({ price: data.priceKopecks, discount, old });
      if (Object.keys(priceErrors).length > 0) throw new ValidationError(Object.values(priceErrors)[0]?.[0] ?? 'Проверьте цены', priceErrors);

      const extra = data.extraCategoryIds !== undefined ? uniqueExtra(data.extraCategoryIds, data.categoryId) : uniqueExtra(curExtra, data.categoryId);
      assertRefs(db, data.categoryId, extra, data.brandId);

      let slug = cur.slug;
      if (data.slug !== undefined && data.slug !== '' && data.slug !== cur.slug) {
        if (productsAdminRepo.slugOwner(db, data.slug, id) !== null) throw new ConflictError('Slug уже занят другим товаром');
        slug = data.slug;
      }
      const sku = data.sku !== undefined ? data.sku : cur.sku;
      if (sku !== null && sku !== cur.sku && productsAdminRepo.skuOwner(db, cur.source, sku, id) !== null) throw new ConflictError('Товар с таким артикулом уже есть');

      const next: Snap = {
        name: data.name,
        slug,
        sku,
        barcode: data.barcode !== undefined ? data.barcode : cur.barcode,
        shortDescription: data.shortDescription !== undefined ? data.shortDescription : cur.shortDescription,
        description: data.description !== undefined ? (cleanDescription(data.description) ?? null) : cur.description,
        categoryId: data.categoryId,
        extraCategoryIds: [...extra].sort((a, b) => a - b),
        brandId: data.brandId !== undefined ? data.brandId : cur.brandId,
        priceKopecks: data.priceKopecks,
        discountPriceKopecks: discount ?? null,
        oldPriceKopecks: old ?? null,
        availability: data.availability !== undefined ? data.availability : before.availability,
        published: data.published ?? cur.published,
        hidden: data.hidden ?? cur.hiddenByAdmin,
        featured: data.featured ?? cur.featured,
        isNew: data.isNew ?? cur.isNew,
        isPromo: data.isPromo ?? cur.isPromo,
        seoTitle: data.seoTitle !== undefined ? data.seoTitle : cur.seoTitle,
        seoDescription: data.seoDescription !== undefined ? data.seoDescription : cur.seoDescription,
        canonicalUrl: data.canonicalUrl !== undefined ? data.canonicalUrl : cur.canonicalUrl,
        indexable: data.indexable ?? cur.indexable,
      };

      const changed = (Object.keys(next) as (keyof Snap)[]).filter((k) => !sameValue(next[k], before[k]));

      // Закупочная — только при праве; значения в журнал не попадают.
      const costChanged = cost && data.purchasePriceKopecks !== undefined && data.purchasePriceKopecks !== cur.purchasePriceKopecks;

      const attrs = resolveAttributes(db, data.attributes, [next.categoryId, ...extra], storedAttributes(db, id), data.attributes !== undefined);
      const attrsChanged = attrs.write.length > 0 || attrs.remove.length > 0;

      const columns: Partial<ProductColumns> = {};
      const set = <K extends keyof ProductColumns>(k: K, v: ProductColumns[K]) => {
        columns[k] = v;
      };
      if (changed.includes('name')) set('name', next.name);
      if (changed.includes('slug')) set('slug', next.slug);
      if (changed.includes('sku')) set('sku', next.sku);
      if (changed.includes('barcode')) set('barcode', next.barcode);
      if (changed.includes('shortDescription')) set('shortDescription', next.shortDescription);
      if (changed.includes('description')) set('description', next.description);
      if (changed.includes('categoryId')) set('categoryId', next.categoryId);
      if (changed.includes('brandId')) set('brandId', next.brandId);
      if (changed.includes('priceKopecks')) set('priceKopecks', next.priceKopecks);
      if (changed.includes('discountPriceKopecks')) set('discountPriceKopecks', next.discountPriceKopecks);
      if (changed.includes('oldPriceKopecks')) set('oldPriceKopecks', next.oldPriceKopecks);
      if (changed.includes('published')) set('published', next.published);
      if (changed.includes('hidden')) set('hiddenByAdmin', next.hidden);
      if (changed.includes('featured')) set('featured', next.featured);
      if (changed.includes('isNew')) set('isNew', next.isNew);
      if (changed.includes('isPromo')) set('isPromo', next.isPromo);
      if (changed.includes('canonicalUrl')) set('canonicalUrl', next.canonicalUrl);
      if (changed.includes('indexable')) set('indexable', next.indexable);
      if (costChanged) set('purchasePriceKopecks', data.purchasePriceKopecks ?? null);

      const touched: string[] = [...changed];
      if (attrsChanged) touched.push('attributes');

      // остаток и резерв — только через сервис, причина обязательна
      const wantsStock = (data.stockQty !== undefined && data.stockQty !== cur.stockQty) || (data.reservedQty !== undefined && data.reservedQty !== cur.reservedQty);
      if (wantsStock && !(data.stockReason ?? '').trim()) throw new ValidationError('Укажите причину изменения остатка', { stockReason: ['Укажите причину изменения остатка'] });

      productsAdminRepo.update(db, id, columns, iso(now));
      if (changed.includes('categoryId') || changed.includes('extraCategoryIds')) productCategoriesRepo.setExtra(db, id, next.categoryId, extra);
      if (changed.includes('seoTitle') || changed.includes('seoDescription')) productsAdminRepo.upsertSeo(db, id, { title: next.seoTitle, description: next.seoDescription }, now);
      for (const w of attrs.write) attributesRepo.setProductValue(db, id, w.attributeId, w.text, w.num);
      for (const r of attrs.remove) attributesRepo.removeProductValue(db, id, r);

      const stockChanged = applyStock(db, session, id, cur, data, now, false);
      if (stockChanged) touched.push('stock');
      if (changed.includes('availability')) applyAvailability(db, id, next.availability);

      if (touched.length > 0) productsAdminRepo.setLocked(db, id, addLocks(mustFind(db, id).lockedFields, touched));

      const pick = (s: Snap) => Object.fromEntries(changed.map((k) => [k, s[k]]));
      if (changed.length > 0 || attrsChanged || costChanged || stockChanged) {
        const priceTouched = changed.includes('priceKopecks') || changed.includes('discountPriceKopecks') || changed.includes('oldPriceKopecks');
        audit.record(
          {
            actorId: session.staffId,
            actorType: 'staff',
            action: priceTouched ? 'price.change' : 'product.update',
            entity: 'product',
            entityId: id,
            before: { ...pick(before), ...(attrsChanged ? { attributes: attrs.before } : {}) },
            after: { ...pick(next), ...(attrsChanged ? { attributes: attrs.after } : {}), ...(costChanged ? { purchasePriceChanged: true } : {}) },
          },
          { db, now },
        );
      }
      clearCategoryImageCache();
      const list: string[] = [...changed];
      if (attrsChanged) list.push('attributes');
      if (stockChanged) list.push('stock');
      if (costChanged) list.push('purchasePrice');
      return { changed: list };
    });
    return result;
  },

  /** Публикация и скрытие отдельно от наличия. */
  async setVisibility(session: StaffSession | null, id: number, v: { published?: boolean; hidden?: boolean }, opts: Opts = {}): Promise<void> {
    requireAny(session, WRITE);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const cur = mustFind(db, id);
      const patch: Partial<ProductColumns> = {};
      const before: Record<string, boolean> = {};
      const after: Record<string, boolean> = {};
      if (v.published !== undefined && v.published !== cur.published) {
        patch.published = v.published;
        before.published = cur.published;
        after.published = v.published;
      }
      if (v.hidden !== undefined && v.hidden !== cur.hiddenByAdmin) {
        patch.hiddenByAdmin = v.hidden;
        before.hidden = cur.hiddenByAdmin;
        after.hidden = v.hidden;
      }
      if (Object.keys(patch).length === 0) return;
      productsAdminRepo.update(db, id, patch, iso(now));
      if ('published' in patch) productsAdminRepo.setLocked(db, id, addLocks(cur.lockedFields, ['published']));
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'product.visibility', entity: 'product', entityId: id, before, after }, { db, now });
    });
    clearCategoryImageCache();
  },

  /** Удаление: запрещено при наличии заказов (скройте товар), иначе удаляет товар и все его связи. */
  async remove(session: StaffSession | null, id: number, opts: Opts = {}): Promise<void> {
    requireAny(session, ['products.delete']);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const cur = mustFind(db, id);
      const deps = productsAdminRepo.dependencies(db, id);
      if (deps.orders > 0) {
        throw new ConflictError(`Товар есть в заказах (${deps.orders}): удалить нельзя. Скрыть товар с сайта можно в карточке: он перестанет продаваться, а история заказов сохранится.`);
      }
      productsAdminRepo.delete(db, id);
      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: 'product.delete',
          entity: 'product',
          entityId: id,
          before: { name: cur.name, slug: cur.slug, sku: cur.sku, categoryId: cur.categoryId, priceKopecks: cur.priceKopecks, removed: deps },
        },
        { db, now },
      );
    });
    clearCategoryImageCache();
  },

  // ───────── изображения ─────────

  /** Загрузка нескольких файлов: либо все принимаются, либо ни один. */
  async addImages(session: StaffSession | null, id: number, files: readonly { bytes: Uint8Array }[], opts: Opts = {}): Promise<{ added: number }> {
    requireAny(session, WRITE);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const dir = opts.uploadsDir ?? defaultUploadsDir();
    mustFind(db, id);
    if (files.length === 0) throw fieldError('images', 'Выберите хотя бы один файл');
    if (files.length > MAX_IMAGES_PER_UPLOAD) throw fieldError('images', `За один раз можно загрузить не больше ${MAX_IMAGES_PER_UPLOAD} файлов`);
    if (productMediaRepo.list(db, id).length + files.length > MAX_IMAGES_PER_PRODUCT) throw fieldError('images', `У товара не больше ${MAX_IMAGES_PER_PRODUCT} фотографий`);

    const stored: StoredImage[] = [];
    try {
      for (const [i, f] of files.entries()) {
        try {
          stored.push(await storeImage(f.bytes, { dir }));
        } catch (e) {
          if (e instanceof ImageStoreError) throw fieldError('images', `Файл ${i + 1}: ${e.message}`);
          throw e;
        }
      }
    } catch (e) {
      await removeFiles(dir, stored);
      throw e;
    }

    try {
      withTransaction(db, () => {
        const cur = mustFind(db, id);
        for (const s of stored) productMediaRepo.addUploaded(db, id, { path: s.path, variants: s.variants, alt: null });
        mediaTouched(db, session, cur, now, { added: stored.length });
      });
    } catch (e) {
      await removeFiles(dir, stored);
      throw e;
    }
    clearCategoryImageCache();
    return { added: stored.length };
  },

  async removeImage(session: StaffSession | null, id: number, imageId: number, opts: Opts = {}): Promise<void> {
    requireAny(session, WRITE);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const dir = opts.uploadsDir ?? defaultUploadsDir();
    const orphan = withTransaction(db, () => {
      const cur = mustFind(db, id);
      const img = productMediaRepo.find(db, id, imageId);
      if (!img) throw new NotFoundError('Изображение не найдено');
      productMediaRepo.remove(db, imageId);
      productMediaRepo.setOrder(db, productMediaRepo.list(db, id).map((i) => i.id));
      mediaTouched(db, session, cur, now, { removed: imageId });
      return img.path && img.urlSource.startsWith('upload:') && !productMediaRepo.pathInUse(db, img.path, imageId) ? img : null;
    });
    if (orphan) await removeFiles(dir, [{ variants: orphan.variants, path: orphan.path as string }]);
    clearCategoryImageCache();
  },

  /** Главное изображение — первое в порядке; остальные сохраняют порядок. */
  async setMainImage(session: StaffSession | null, id: number, imageId: number, opts: Opts = {}): Promise<void> {
    requireAny(session, WRITE);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const cur = mustFind(db, id);
      const list = productMediaRepo.list(db, id);
      if (!list.some((i) => i.id === imageId)) throw new NotFoundError('Изображение не найдено');
      productMediaRepo.setOrder(db, [imageId, ...list.filter((i) => i.id !== imageId).map((i) => i.id)]);
      mediaTouched(db, session, cur, now, { main: imageId });
    });
    clearCategoryImageCache();
  },

  async reorderImages(session: StaffSession | null, id: number, orderedIds: readonly number[], opts: Opts = {}): Promise<void> {
    requireAny(session, WRITE);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const cur = mustFind(db, id);
      const have = productMediaRepo.list(db, id).map((i) => i.id);
      const given = new Set(orderedIds);
      if (given.size !== orderedIds.length || given.size !== have.length || have.some((h) => !given.has(h))) {
        throw fieldError('images', 'Порядок должен содержать все изображения товара по одному разу');
      }
      productMediaRepo.setOrder(db, orderedIds);
      mediaTouched(db, session, cur, now, { order: [...orderedIds] });
    });
    clearCategoryImageCache();
  },

  async setImageAlt(session: StaffSession | null, id: number, imageId: number, alt: string, opts: Opts = {}): Promise<void> {
    requireAny(session, WRITE);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const text = alt.trim();
    if (text.length > MAX_IMAGE_ALT) throw fieldError('alt', `Подпись не длиннее ${MAX_IMAGE_ALT} символов`);
    withTransaction(db, () => {
      const cur = mustFind(db, id);
      if (!productMediaRepo.find(db, id, imageId)) throw new NotFoundError('Изображение не найдено');
      productMediaRepo.setAlt(db, imageId, text === '' ? null : text);
      mediaTouched(db, session, cur, now, { alt: imageId });
    });
  },
};

/** Любая правка фото закрепляет images за ручной правкой, обновляет время изменения и пишет в журнал. */
function mediaTouched(db: Db, session: StaffSession, cur: ProductFull, now: number, detail: Record<string, unknown>): void {
  productsAdminRepo.setLocked(db, cur.id, addLocks(cur.lockedFields, ['images']));
  db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(iso(now), cur.id);
  audit.record({ actorId: session.staffId, actorType: 'staff', action: 'product.images', entity: 'product', entityId: cur.id, after: detail }, { db, now });
}

async function removeFiles(dir: string, items: readonly { variants: readonly { path: string }[]; path: string }[]): Promise<void> {
  const names = new Set<string>();
  for (const i of items) {
    names.add(i.path);
    for (const v of i.variants) names.add(v.path);
  }
  await Promise.all([...names].map((n) => rm(join(dir, n), { force: true }).catch(() => undefined)));
}

export { isSellable };
