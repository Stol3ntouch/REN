/*
 * Применение плана CSV. Два режима:
 *  - batch: пакеты по BATCH_SIZE строк, каждый в своей транзакции; ошибочная строка откатывается сама (savepoint) и идёт в отчёт;
 *    между пакетами пишется прогресс и серверу возвращается управление;
 *  - atomic: одна транзакция на весь файл (до ATOMIC_MAX_ROWS строк) — любая ошибка откатывает всё.
 * Фото (по галочке) скачиваются после записи и ничего не откатывают.
 */
import { randomUUID } from 'node:crypto';
import { clearCategoryImageCache } from '@/domain/catalog/category-images';
import { slugify, uniqueSlug } from '@/importing/yml/slug';
import { withTransaction, type Db } from '@/server/db/connection';
import { foldText } from '@/server/db/fold';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { brandsRepo } from '@/server/db/repositories/brands';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { imagesRepo } from '@/server/db/repositories/images';
import { productsRepo } from '@/server/db/repositories/products';
import { productsAdminRepo, type ProductColumns } from '@/server/db/repositories/products-admin';
import { stockRepo, type Availability } from '@/server/db/repositories/stock';
import { warehousesRepo } from '@/server/db/repositories/warehouses';
import { ATOMIC_MAX_ROWS, BATCH_SIZE } from '../limits';
import { downloadImages, type ImageDownloadOptions } from '../images';
import type { ImportOptions } from '../options';
import type { Issue } from '../rows';
import type { CsvPlan, Intent, PlannedRow } from './plan';
import { loadRefs, resolveCategory, type CatalogRefs } from './refs';

export type ApplyOutcome = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  categoriesCreated: number;
  brandsCreated: number;
  imagesStored: number;
  imagesFailed: number;
  processed: number;
  /** atomic: файл не применён, всё откачено. */
  rolledBack: boolean;
  errors: Issue[];
};

export type ApplyParams = {
  runId: number;
  actorId: number | null;
  now: number;
  options: ImportOptions;
  images?: ImageDownloadOptions;
  /** Вызывается после каждого зафиксированного пакета. */
  onProgress?: (processed: number) => void;
};

type Ctx = { db: Db; refs: CatalogRefs; params: ApplyParams; iso: string; counters: { categories: number; brands: number } };

const yieldTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Категория строки: найденная либо (при unknownRefs=create) созданная вместе с недостающими родителями. */
function ensureCategory(ctx: Ctx, ref: string): number {
  const res = resolveCategory(ctx.refs, ref);
  if (res.kind === 'found') return res.id;
  if (res.kind === 'ambiguous') throw new Error(res.message);
  if (ctx.params.options.unknownRefs !== 'create') throw new Error(`Категория «${ref}» не найдена`);
  let parentId = res.parentId;
  for (const name of res.missing) {
    const clean = name.trim();
    const taken = categoriesRepo.allSlugs(ctx.db);
    const slug = uniqueSlug(slugify(clean) || 'category', String(parentId ?? 'root'), taken);
    const id = categoriesRepo.insert(ctx.db, { source: 'csv', externalId: `csv:${parentId ?? 0}:${foldText(clean)}`, parentId, name: clean, slug, sort: 0 });
    ctx.counters.categories++;
    parentId = id;
  }
  ctx.refs = loadRefs(ctx.db);
  return parentId as number;
}

function ensureBrand(ctx: Ctx, name: string): number {
  const clean = name.trim();
  const hit = ctx.refs.brands.get(foldText(clean));
  if (hit) return hit.id;
  if (ctx.params.options.unknownRefs !== 'create') throw new Error(`Бренд «${clean}» не найден`);
  const slug = uniqueSlug(slugify(clean) || 'brand', 'csv', brandsRepo.allSlugs(ctx.db));
  const id = brandsRepo.insert(ctx.db, { name: clean, slug, description: null, siteUrl: null, published: true, sort: 0, seoTitle: null, seoDescription: null, source: 'csv', externalId: foldText(clean) }, ctx.iso);
  ctx.counters.brands++;
  ctx.refs = loadRefs(ctx.db);
  return id;
}

/** Slug нового товара: из файла, иначе транслитерация названия; занятый добирается числом (-2, -3…). */
function freeSlug(db: Db, wanted: string | undefined, name: string): string {
  const base = wanted ?? (slugify(name) || 'tovar');
  if (productsAdminRepo.slugOwner(db, base) === null) return base;
  for (let n = 2; ; n++) if (productsAdminRepo.slugOwner(db, `${base}-${n}`) === null) return `${base}-${n}`;
}

/**
 * Остаток из файла. Как ручная операция (stock.adjust) пишет движение и учёт по складам, но НЕ закрепляет in_stock:
 * иначе первый же импорт остатков заблокировал бы все следующие. Закреплённый вручную in_stock проверяет план.
 */
function writeStock(ctx: Ctx, productId: number, qty: number): void {
  const row = stockRepo.get(ctx.db, productId);
  if (!row) throw new Error('Товар не найден');
  if (qty < row.reservedQty) throw new Error(`Остаток ${qty} меньше резерва по заказам (${row.reservedQty})`);
  const delta = qty - row.stockQty;
  if (delta === 0 && row.tracked) return;
  const availability: Availability = row.availabilityManual ? row.availability : qty - row.reservedQty > 0 ? 'in_stock' : 'out_of_stock';
  stockRepo.save(ctx.db, productId, { stockQty: qty, reservedQty: row.reservedQty, availability, lockedFields: row.lockedFields, now: ctx.iso, warehouseId: null });
  stockRepo.insertMovement(ctx.db, {
    productId,
    delta,
    qtyAfter: qty,
    reservedDelta: 0,
    reservedAfter: row.reservedQty,
    reason: `Импорт CSV №${ctx.params.runId}`,
    ref: `import:${ctx.params.runId}`,
    staffId: ctx.params.actorId,
    createdAt: ctx.iso,
    warehouseId: warehousesRepo.defaultId(ctx.db),
  });
}

function writeAttrs(ctx: Ctx, productId: number, attrs: NonNullable<Intent['attrs']>): void {
  for (const [code, val] of Object.entries(attrs)) {
    const def = ctx.refs.attrs.get(code.toLowerCase());
    if (!def) continue;
    if (val === null) attributesRepo.removeProductValue(ctx.db, productId, def.id);
    else attributesRepo.setProductValue(ctx.db, productId, def.id, val.text, val.num);
  }
}

function createProduct(ctx: Ctx, intent: Intent): number {
  const { db } = ctx;
  if (intent.name === undefined || intent.priceKopecks === undefined || intent.category === undefined) throw new Error('Не хватает обязательных полей нового товара');
  const categoryId = ensureCategory(ctx, intent.category);
  const brandId = intent.brand ? ensureBrand(ctx, intent.brand) : null;
  const id = productsAdminRepo.insertManual(db, {
    externalId: intent.externalId ?? `manual-${randomUUID()}`,
    sku: intent.sku ?? null,
    barcode: intent.barcode ?? null,
    name: intent.name,
    slug: freeSlug(db, intent.slug, intent.name),
    shortDescription: null,
    description: intent.description ?? null,
    categoryId,
    brandId,
    priceKopecks: intent.priceKopecks,
    discountPriceKopecks: null,
    oldPriceKopecks: intent.oldPriceKopecks ?? null,
    purchasePriceKopecks: null,
    published: intent.published ?? true,
    hiddenByAdmin: false,
    featured: false,
    isNew: false,
    isPromo: false,
    canonicalUrl: null,
    indexable: true,
    createdBy: ctx.params.actorId,
    now: ctx.iso,
  });
  if (intent.attrs) writeAttrs(ctx, id, intent.attrs);
  if (intent.images && intent.images.length > 0) imagesRepo.replaceForProduct(db, id, intent.images, intent.name);
  if (intent.stockQty !== undefined) writeStock(ctx, id, intent.stockQty);
  return id;
}

function updateProduct(ctx: Ctx, row: PlannedRow): void {
  const { db } = ctx;
  const id = row.productId as number;
  const intent = row.intent;
  const has = (f: string) => row.changes.includes(f);
  const patch: Partial<ProductColumns> = {};
  if (has('name')) patch.name = intent.name as string;
  if (has('sku')) patch.sku = intent.sku as string;
  if (has('slug')) patch.slug = freeSlug(db, intent.slug, intent.name ?? 'tovar');
  if (has('barcode')) patch.barcode = intent.barcode ?? null;
  if (has('description')) patch.description = intent.description ?? null;
  if (has('category')) patch.categoryId = ensureCategory(ctx, intent.category as string);
  if (has('brand')) patch.brandId = intent.brand ? ensureBrand(ctx, intent.brand) : null;
  if (has('price')) patch.priceKopecks = intent.priceKopecks as number;
  if (has('oldPrice')) patch.oldPriceKopecks = intent.oldPriceKopecks ?? null;
  if (has('published')) patch.published = intent.published as boolean;
  productsAdminRepo.update(db, id, patch, ctx.iso);
  if (intent.attrs) {
    const only: NonNullable<Intent['attrs']> = {};
    for (const [code, v] of Object.entries(intent.attrs)) if (has(`attr:${code}`)) only[code] = v;
    writeAttrs(ctx, id, only);
  }
  if (has('images')) imagesRepo.replaceForProduct(db, id, intent.images ?? [], intent.name ?? null);
  if (has('stock')) writeStock(ctx, id, intent.stockQty as number);
  productsRepo.touch(db, id, ctx.iso); // и когда менялись только характеристики, фото или остаток
}

const emptyOutcome = (): ApplyOutcome => ({ created: 0, updated: 0, skipped: 0, failed: 0, categoriesCreated: 0, brandsCreated: 0, imagesStored: 0, imagesFailed: 0, processed: 0, rolledBack: false, errors: [] });

/** Применяет план. Строки с вердиктом error не применяются никогда; в atomic их наличие проверяет вызывающий. */
export async function applyRows(db: Db, plan: CsvPlan, params: ApplyParams): Promise<ApplyOutcome> {
  const out = emptyOutcome();
  const iso = new Date(params.now).toISOString();
  const rowByProduct = new Map<number, number>();
  const touched: number[] = [];

  const run = (rows: readonly PlannedRow[], ctx: Ctx, perRowSavepoint: boolean): { created: number; updated: number; skipped: number; failed: number; errors: Issue[]; ids: [number, number][] } => {
    const r = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] as Issue[], ids: [] as [number, number][] };
    for (const row of rows) {
      if (row.verdict === 'skip') {
        r.skipped++;
        continue;
      }
      if (row.verdict === 'error') {
        r.failed++;
        r.errors.push(...row.issues);
        continue;
      }
      const attempt = () => {
        if (row.verdict === 'create') {
          const id = createProduct(ctx, row.intent);
          r.ids.push([id, row.rowNo]);
        } else {
          updateProduct(ctx, row);
          r.ids.push([row.productId as number, row.rowNo]);
        }
      };
      if (!perRowSavepoint) {
        attempt();
      } else {
        const snapshot = { ...ctx.counters };
        try {
          withTransaction(db, attempt);
        } catch (e) {
          // строка откатилась; справочники в памяти могли «увидеть» откатанные категории/бренды — перечитываем
          ctx.counters.categories = snapshot.categories;
          ctx.counters.brands = snapshot.brands;
          ctx.refs = loadRefs(db);
          r.failed++;
          r.errors.push({ row: row.rowNo, field: '', message: `Строка не записана: ${errText(e)}` });
          continue;
        }
      }
      if (row.verdict === 'create') r.created++;
      else r.updated++;
    }
    return r;
  };

  const mk = (): Ctx => ({ db, refs: loadRefs(db), params, iso, counters: { categories: 0, brands: 0 } });

  if (params.options.transaction === 'atomic') {
    if (plan.rows.length > ATOMIC_MAX_ROWS) throw new Error(`В режиме «всё или ничего» не больше ${ATOMIC_MAX_ROWS} строк`);
    const ctx = mk();
    try {
      const r = withTransaction(db, () => run(plan.rows, ctx, false));
      out.created = r.created;
      out.updated = r.updated;
      out.skipped = r.skipped;
      out.failed = r.failed;
      out.errors.push(...r.errors);
      out.categoriesCreated = ctx.counters.categories;
      out.brandsCreated = ctx.counters.brands;
      for (const [pid, rowNo] of r.ids) {
        touched.push(pid);
        rowByProduct.set(pid, rowNo);
      }
    } catch (e) {
      out.rolledBack = true;
      out.errors.push({ row: 0, field: '', message: `Импорт отменён, изменений нет: ${errText(e)}` });
    }
    out.processed = plan.rows.length;
    params.onProgress?.(out.processed);
  } else {
    let ctx = mk();
    for (let i = 0; i < plan.rows.length; i += BATCH_SIZE) {
      const chunk = plan.rows.slice(i, i + BATCH_SIZE);
      try {
        const r = withTransaction(db, () => run(chunk, ctx, true));
        out.created += r.created;
        out.updated += r.updated;
        out.skipped += r.skipped;
        out.failed += r.failed;
        out.errors.push(...r.errors);
        for (const [pid, rowNo] of r.ids) {
          touched.push(pid);
          rowByProduct.set(pid, rowNo);
        }
        out.categoriesCreated += ctx.counters.categories;
        out.brandsCreated += ctx.counters.brands;
        ctx.counters.categories = 0;
        ctx.counters.brands = 0;
      } catch (e) {
        // критическая ошибка пакета (не строки): пакет откатился целиком, остальные продолжают
        out.failed += chunk.length;
        out.errors.push({ row: chunk[0]?.rowNo ?? 0, field: '', message: `Пакет строк ${chunk[0]?.rowNo}–${chunk[chunk.length - 1]?.rowNo} откатан: ${errText(e)}` });
        ctx = mk();
      }
      out.processed = Math.min(plan.rows.length, i + chunk.length);
      params.onProgress?.(out.processed);
      await yieldTick();
    }
  }

  if (!out.rolledBack && params.options.downloadImages && touched.length > 0) {
    const r = await downloadImages(db, touched, rowByProduct, params.images);
    out.imagesStored = r.stored;
    out.imagesFailed = r.failed;
    out.errors.push(...r.errors);
  }
  clearCategoryImageCache();
  return out;
}
