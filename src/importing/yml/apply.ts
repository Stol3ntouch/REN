import { safeFetchImage } from '@/media/safe-fetch';
import { storeImage, type StoredImage } from '@/media/store-image';
import { withTransaction, type Db } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { imagesRepo } from '@/server/db/repositories/images';
import { importRunsRepo } from '@/server/db/repositories/import-runs';
import { productsRepo, type ProductPatch } from '@/server/db/repositories/products';
import { categorySlugBase, diffProduct, productSlugBase } from './plan';
import { uniqueSlug } from './slug';
import { YML_SOURCE, type ImportPlan, type ImportReport, type RowError } from './types';

export type ImageIngestOptions = {
  /** Скачивание; по умолчанию safeFetchImage (allowlist, SSRF-защита). */
  fetchImage?: (url: string) => Promise<{ bytes: Uint8Array }>;
  /** Сохранение; по умолчанию storeImage (сигнатура, перекодирование, варианты). */
  storeImage?: (bytes: Uint8Array) => Promise<StoredImage>;
  concurrency?: number;
};

export type ApplyOptions = {
  now?: Date;
  actorId?: number | null;
  /** Скачивать фото (по умолчанию нет: хранится только url_source). */
  images?: false | ImageIngestOptions;
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Применяет план к БД идемпотентно по (source='yml', external_id). Товары, которых нет в файле, не удаляются;
 * поля из locked_fields не перезаписываются; сбой одной строки откатывает только её и попадает в отчёт.
 * Скачивание фото (если включено) идёт после записи и не блокирует импорт.
 */
export async function applyImport(plan: ImportPlan, db: Db, opts: ApplyOptions = {}): Promise<ImportReport> {
  const startedAt = (opts.now ?? new Date()).toISOString();
  const nowIso = startedAt;
  const errors: RowError[] = [...plan.errors];
  const report: ImportReport = {
    runId: 0,
    fileName: plan.fileName,
    startedAt,
    finishedAt: startedAt,
    categories: { created: 0, updated: 0, unchanged: 0 },
    products: { created: 0, updated: 0, unchanged: 0, lockedFieldsSkipped: 0 },
    images: { enabled: !!opts.images, stored: 0, failed: 0, pending: 0 },
    errors,
    notes: [],
  };
  const touchedProducts = new Map<number, string>(); // id → externalId

  withTransaction(db, () => {
    // --- категории: сначала создаём/переименовываем, затем расставляем родителей (порядок в файле не важен)
    const takenCategorySlugs = categoriesRepo.allSlugs(db);
    const idByExternal = new Map<string, number>();
    for (const c of categoriesRepo.listAll(db)) if (c.source === YML_SOURCE) idByExternal.set(c.externalId, c.id);
    const created = new Set<string>();
    const touchedCategories = new Set<string>();

    for (const pc of plan.categories) {
      const cat = pc.data;
      try {
        withTransaction(db, () => {
          const existing = categoriesRepo.findByExternalId(db, YML_SOURCE, cat.externalId);
          if (!existing) {
            const slug = takenCategorySlugs.has(pc.slug) ? uniqueSlug(categorySlugBase(cat), cat.externalId, takenCategorySlugs) : (takenCategorySlugs.add(pc.slug), pc.slug);
            idByExternal.set(cat.externalId, categoriesRepo.insert(db, { source: YML_SOURCE, externalId: cat.externalId, parentId: null, name: cat.name, slug, sort: cat.position }));
            created.add(cat.externalId);
          } else if (existing.name !== cat.name) {
            categoriesRepo.update(db, existing.id, { name: cat.name });
            touchedCategories.add(cat.externalId);
          }
        });
      } catch (e) {
        errors.push({ kind: 'category', externalId: cat.externalId, position: cat.position, message: `Категория ${cat.externalId}: ${errorText(e)}` });
      }
    }
    for (const pc of plan.categories) {
      const cat = pc.data;
      const id = idByExternal.get(cat.externalId);
      if (id === undefined) continue;
      const parentId = cat.parentExternalId === null ? null : (idByExternal.get(cat.parentExternalId) ?? null);
      const current = categoriesRepo.listAll(db).find((c) => c.id === id)?.parentId ?? null;
      if (current !== parentId) {
        categoriesRepo.update(db, id, { parentId });
        touchedCategories.add(cat.externalId);
      }
      if (created.has(cat.externalId)) report.categories.created++;
      else if (touchedCategories.has(cat.externalId)) report.categories.updated++;
      else report.categories.unchanged++;
    }

    // --- товары
    const takenProductSlugs = productsRepo.allSlugs(db);
    for (const pp of plan.products) {
      const offer = pp.data;
      try {
        withTransaction(db, () => {
          const categoryId = idByExternal.get(offer.categoryExternalId);
          if (categoryId === undefined) throw new Error(`категория ${offer.categoryExternalId} не найдена`);
          const existing = productsRepo.findByExternalId(db, YML_SOURCE, offer.externalId);

          if (!existing) {
            const slug = takenProductSlugs.has(pp.slug) ? uniqueSlug(productSlugBase(offer), offer.externalId, takenProductSlugs) : (takenProductSlugs.add(pp.slug), pp.slug);
            const id = productsRepo.insert(db, {
              source: YML_SOURCE,
              externalId: offer.externalId,
              sku: offer.sku,
              name: offer.name,
              slug,
              description: offer.description,
              categoryId,
              priceKopecks: offer.priceKopecks,
              inStock: offer.inStock,
              now: nowIso,
            });
            attributesRepo.replaceForProduct(db, id, offer.attributes);
            imagesRepo.replaceForProduct(db, id, offer.pictures, offer.name);
            touchedProducts.set(id, offer.externalId);
            report.products.created++;
            return;
          }

          touchedProducts.set(existing.id, offer.externalId);
          // Решение принимается по текущему состоянию БД (план мог устареть) и актуальному locked_fields.
          const diff = diffProduct(db, existing, offer);
          report.products.lockedFieldsSkipped += diff.lockedSkipped.length;
          if (diff.changes.length === 0) {
            report.products.unchanged++;
            return;
          }
          const patch: ProductPatch = {};
          for (const f of diff.changes) {
            if (f === 'name') patch.name = offer.name;
            else if (f === 'sku') patch.sku = offer.sku;
            else if (f === 'description') patch.description = offer.description;
            else if (f === 'category') patch.categoryId = categoryId;
            else if (f === 'price') patch.priceKopecks = offer.priceKopecks;
            else if (f === 'in_stock') patch.inStock = offer.inStock;
          }
          productsRepo.update(db, existing.id, patch, nowIso);
          if (diff.changes.includes('attributes')) attributesRepo.replaceForProduct(db, existing.id, offer.attributes);
          if (diff.changes.includes('images')) imagesRepo.replaceForProduct(db, existing.id, offer.pictures, patch.name ?? existing.name);
          productsRepo.touch(db, existing.id, nowIso); // и когда менялись только характеристики или фото
          report.products.updated++;
        });
      } catch (e) {
        errors.push({ kind: 'offer', externalId: offer.externalId, position: offer.position, message: `Товар ${offer.externalId}: не записан — ${errorText(e)}` });
      }
    }
  });

  // --- фото: после записи, вне транзакции; сбои идут в отчёт и ничего не откатывают
  const productIds = [...touchedProducts.keys()];
  if (opts.images) await ingestImages(db, productIds, touchedProducts, opts.images, report);
  report.images.pending = imagesRepo.listPending(db, productIds).length;

  report.finishedAt = (opts.now ?? new Date()).toISOString();
  report.runId = importRunsRepo.insert(db, {
    fileName: plan.fileName,
    mode: 'apply',
    actorId: opts.actorId ?? null,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    categoriesCreated: report.categories.created,
    categoriesUpdated: report.categories.updated,
    productsCreated: report.products.created,
    productsUpdated: report.products.updated,
    productsUnchanged: report.products.unchanged,
    imagesStored: report.images.stored,
    imagesFailed: report.images.failed,
    errors,
    errorCount: errors.length,
  });
  return report;
}

async function ingestImages(db: Db, productIds: number[], externalIds: Map<number, string>, o: ImageIngestOptions, report: ImportReport): Promise<void> {
  const fetchImage = o.fetchImage ?? ((url: string) => safeFetchImage(url));
  const store = o.storeImage ?? ((bytes: Uint8Array) => storeImage(bytes));
  const pending = imagesRepo.listPending(db, productIds);
  const byUrl = new Map<string, Promise<StoredImage>>(); // один URL у нескольких товаров — одна загрузка
  let next = 0;

  const worker = async () => {
    for (;;) {
      const row = pending[next++];
      if (!row) return;
      try {
        let job = byUrl.get(row.urlSource);
        if (!job) {
          job = fetchImage(row.urlSource).then((r) => store(r.bytes));
          byUrl.set(row.urlSource, job);
        }
        const stored = await job;
        imagesRepo.setStored(db, row.id, { path: stored.path, variants: stored.variants });
        report.images.stored++;
      } catch (e) {
        report.images.failed++;
        report.errors.push({ kind: 'image', externalId: externalIds.get(row.productId), message: `Фото ${row.urlSource}: ${errorText(e)}` });
      }
    }
  };
  const n = Math.max(1, Math.min(o.concurrency ?? 4, 16));
  await Promise.all(Array.from({ length: Math.min(n, pending.length) }, worker));
}
