import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { hasPermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { clearCategoryImageCache } from '@/domain/catalog/category-images';
import {
  countProducts,
  CSV_BOM,
  exportBatch,
  exportHeader,
  exportLine,
  filterOf,
  filterToParams,
  listProducts,
  selectProductIds,
  type ProductFilter,
  type ProductListQuery,
  type ProductListResult,
} from '@/domain/catalog/products-list';
import { productSlugFrom } from '@/domain/catalog/products-admin';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { brandsRepo } from '@/server/db/repositories/brands';
import { productCategoriesRepo } from '@/server/db/repositories/product-categories';
import { productsAdminRepo } from '@/server/db/repositories/products-admin';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

/** Предел массового действия и «всех по фильтру» (ТЗ: до 5000). */
export const MAX_BULK = 5000;
/** Предел строк выгрузки. */
export const MAX_EXPORT_ROWS = 20_000;
const EXPORT_BATCH = 500;

const READ: readonly Permission[] = ['products.read', 'catalog.read'];
const WRITE: readonly Permission[] = ['products.write', 'catalog.write'];

function requireAny(session: StaffSession | null | undefined, perms: readonly Permission[]): asserts session is StaffSession {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!perms.some((p) => hasPermission(session, p))) throw new ForbiddenError('Недостаточно прав для этого действия');
}

const iso = (now: number) => new Date(now).toISOString();
const id = z.number({ error: 'Укажите товар' }).int().positive();

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('publish') }),
  z.object({ type: z.literal('unpublish') }),
  z.object({ type: z.literal('hide') }),
  z.object({ type: z.literal('show') }),
  z.object({ type: z.literal('move'), categoryId: z.number({ error: 'Выберите категорию' }).int().positive() }),
  z.object({ type: z.literal('addCategory'), categoryId: z.number({ error: 'Выберите категорию' }).int().positive() }),
  z.object({ type: z.literal('brand'), brandId: z.number().int().positive().nullable() }),
  z.object({ type: z.literal('flag'), flag: z.enum(['isNew', 'featured', 'isPromo']), value: z.boolean() }),
]);
export type BulkAction = z.input<typeof actionSchema>;

export type BulkTarget = { ids: readonly number[] } | { filter: ProductFilter; expectedTotal: number };

export type BulkReport = {
  /** Сколько товаров было выбрано. */
  total: number;
  changed: number;
  /** Уже в нужном состоянии или пропущены. */
  skipped: number;
  errors: { id: number; message: string }[];
};

/** Какое закрепление за ручной правкой ставит действие (чтобы импорт YML не откатил результат). */
const LOCK: Partial<Record<string, string>> = { publish: 'published', unpublish: 'published', move: 'category', brand: 'brand', isNew: 'flags', isPromo: 'flags', featured: 'featured' };

function lockedList(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function resolveIds(db: Db, target: BulkTarget): { ids: number[]; scope: 'ids' | 'filter'; filter?: ProductFilter } {
  if ('ids' in target) {
    const parsed = z.array(id, { error: 'Выберите товары' }).min(1, 'Выберите хотя бы один товар').max(MAX_BULK, `За один раз можно выбрать не больше ${MAX_BULK} товаров`).safeParse([...target.ids]);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Выберите товары');
    return { ids: [...new Set(parsed.data)], scope: 'ids' };
  }
  const total = countProducts(db, target.filter);
  if (total === 0) throw new ValidationError('Под фильтр не попал ни один товар');
  if (total > MAX_BULK) throw new ValidationError(`Под фильтр попало ${total} товаров: за один раз можно изменить не больше ${MAX_BULK}. Сузьте фильтр.`);
  if (total !== target.expectedTotal) throw new ConflictError(`Число товаров под фильтр изменилось: было ${target.expectedTotal}, стало ${total}. Проверьте список и повторите.`);
  return { ids: selectProductIds(db, target.filter, MAX_BULK), scope: 'filter', filter: target.filter };
}

type Cur = { id: number; published: number; hidden_by_admin: number; category_id: number; brand_id: number | null; is_new: number; featured: number; is_promo: number; locked_fields: string };

export const productListOps = {
  /** Серверный список: поиск, фильтры, сортировка, страница. Закупочной цены в строках нет вообще. */
  list(session: StaffSession | null, query: ProductListQuery, opts: Opts = {}): ProductListResult {
    requireAny(session, READ);
    return listProducts(opts.db ?? getDb(), query);
  },

  /** Сколько товаров под отбор (для подтверждения «все по фильтру»). */
  count(session: StaffSession | null, filter: ProductFilter, opts: Opts = {}): number {
    requireAny(session, READ);
    return countProducts(opts.db ?? getDb(), filter);
  },

  /**
   * Массовое действие над выбранными (ids) или всеми по фильтру. Одна транзакция, идемпотентно (уже совпавшие — «пропущено»),
   * одна запись в аудите: действие, число и фильтр. Право products.write.
   */
  bulk(session: StaffSession | null, actionInput: unknown, target: BulkTarget, opts: Opts = {}): BulkReport {
    requireAny(session, WRITE);
    const parsed = actionSchema.safeParse(actionInput);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Выберите действие');
    const action = parsed.data;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();

    const report = withTransaction(db, () => {
      const resolved = resolveIds(db, target);

      if (action.type === 'move' || action.type === 'addCategory') {
        if (!productCategoriesRepo.existing(db, [action.categoryId]).has(action.categoryId)) throw new ValidationError('Категория не найдена');
      }
      if (action.type === 'brand' && action.brandId !== null) {
        const b = brandsRepo.findById(db, action.brandId);
        if (!b || b.archived) throw new ValidationError('Бренд не найден');
      }

      const rows = new Map<number, Cur>();
      const sel = db.prepare(
        'SELECT id, published, hidden_by_admin, category_id, brand_id, is_new, featured, is_promo, locked_fields FROM products WHERE id IN (SELECT value FROM json_each(?))',
      );
      for (let i = 0; i < resolved.ids.length; i += 1000) for (const r of sel.all(JSON.stringify(resolved.ids.slice(i, i + 1000))) as Cur[]) rows.set(r.id, r);

      const out: BulkReport = { total: resolved.ids.length, changed: 0, skipped: 0, errors: [] };
      const stamp = iso(now);
      const setLocked = db.prepare('UPDATE products SET locked_fields = ? WHERE id = ?');
      const lockKey = action.type === 'flag' ? LOCK[action.flag] : LOCK[action.type];
      const lock = (r: Cur) => {
        if (!lockKey) return;
        const list = lockedList(r.locked_fields);
        if (!list.includes(lockKey)) setLocked.run(JSON.stringify([...list, lockKey]), r.id);
      };
      const update = (column: string): ((value: number | null, productId: number) => void) => {
        const st = db.prepare(`UPDATE products SET ${column} = ?, updated_at = ? WHERE id = ?`);
        return (value, productId) => void st.run(value, stamp, productId);
      };
      const addExtra = db.prepare(
        'INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary, sort) VALUES (?, ?, 0, (SELECT COALESCE(MAX(sort), 0) + 1 FROM product_categories WHERE product_id = ?))',
      );
      const writers = {
        published: update('published'),
        hidden: update('hidden_by_admin'),
        category: update('category_id'),
        brand: update('brand_id'),
        isNew: update('is_new'),
        featured: update('featured'),
        isPromo: update('is_promo'),
      };

      for (const pid of resolved.ids) {
        const r = rows.get(pid);
        if (!r) {
          out.errors.push({ id: pid, message: 'Товар не найден' });
          continue;
        }
        let did = false;
        switch (action.type) {
          case 'publish':
          case 'unpublish': {
            const want = action.type === 'publish' ? 1 : 0;
            if (r.published !== want) {
              writers.published(want, pid);
              did = true;
            }
            break;
          }
          case 'hide':
          case 'show': {
            const want = action.type === 'hide' ? 1 : 0;
            if (r.hidden_by_admin !== want) {
              writers.hidden(want, pid);
              did = true;
            }
            break;
          }
          case 'move':
            if (r.category_id !== action.categoryId) {
              writers.category(action.categoryId, pid);
              did = true;
            }
            break;
          case 'addCategory':
            if (r.category_id !== action.categoryId && addExtra.run(pid, action.categoryId, pid).changes > 0) did = true;
            break;
          case 'brand':
            if (r.brand_id !== action.brandId) {
              writers.brand(action.brandId, pid);
              did = true;
            }
            break;
          case 'flag': {
            const want = action.value ? 1 : 0;
            const have = action.flag === 'isNew' ? r.is_new : action.flag === 'featured' ? r.featured : r.is_promo;
            if (have !== want) {
              writers[action.flag](want, pid);
              did = true;
            }
            break;
          }
        }
        if (did) {
          lock(r);
          out.changed += 1;
        } else {
          out.skipped += 1;
        }
      }

      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: 'product.bulk',
          entity: 'product',
          after: {
            action,
            scope: resolved.scope,
            filter: resolved.filter ? filterToParams(resolved.filter) : undefined,
            total: out.total,
            changed: out.changed,
            skipped: out.skipped,
            errors: out.errors.length,
            ids: resolved.ids.slice(0, 20),
          },
        },
        { db, now },
      );
      return out;
    });
    if (report.changed > 0) clearCategoryImageCache();
    return report;
  },

  /**
   * Массовое удаление: только товары без заказов, остальные пропускаются с причиной. Право products.delete.
   * Одна транзакция и одна запись аудита с числом.
   */
  bulkRemove(session: StaffSession | null, target: BulkTarget, opts: Opts = {}): BulkReport {
    requireAny(session, ['products.delete']);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const report = withTransaction(db, () => {
      const resolved = resolveIds(db, target);
      const out: BulkReport = { total: resolved.ids.length, changed: 0, skipped: 0, errors: [] };
      const removed: number[] = [];
      for (const pid of resolved.ids) {
        const cur = productsAdminRepo.findById(db, pid);
        if (!cur) {
          out.skipped += 1;
          continue;
        }
        const deps = productsAdminRepo.dependencies(db, pid);
        if (deps.orders > 0) {
          out.skipped += 1;
          out.errors.push({ id: pid, message: `«${cur.name}»: есть в заказах (${deps.orders}), удалить нельзя — скройте товар` });
          continue;
        }
        productsAdminRepo.delete(db, pid);
        removed.push(pid);
        out.changed += 1;
      }
      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: 'product.bulk_delete',
          entity: 'product',
          after: { scope: resolved.scope, filter: resolved.filter ? filterToParams(resolved.filter) : undefined, total: out.total, deleted: out.changed, skipped: out.skipped, ids: removed.slice(0, 50) },
        },
        { db, now },
      );
      return out;
    });
    if (report.changed > 0) clearCategoryImageCache();
    return report;
  },

  /**
   * Копия товара: новый slug с суффиксом, пустые артикул и штрихкод, скрыта (published=0), без остатка;
   * копируются категории, характеристики, фото (ссылки на те же файлы) и SEO. Право products.write.
   */
  duplicate(session: StaffSession | null, productId: number, opts: Opts = {}): { id: number; slug: string } {
    requireAny(session, WRITE);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const result = withTransaction(db, () => {
      const src = productsAdminRepo.findById(db, productId);
      if (!src) throw new NotFoundError('Товар не найден');
      const taken = productsAdminRepo.allSlugs(db);
      const name = `${src.name} (копия)`.slice(0, 300);
      const slug = productSlugFrom(`${src.slug}-copy`, taken);
      const newId = productsAdminRepo.insertManual(db, {
        externalId: `manual-${randomUUID()}`,
        sku: null,
        barcode: null,
        name,
        slug,
        shortDescription: src.shortDescription,
        description: src.description,
        categoryId: src.categoryId,
        brandId: src.brandId,
        priceKopecks: src.priceKopecks,
        discountPriceKopecks: src.discountPriceKopecks,
        oldPriceKopecks: src.oldPriceKopecks,
        purchasePriceKopecks: src.purchasePriceKopecks,
        published: false,
        hiddenByAdmin: false,
        featured: src.featured,
        isNew: src.isNew,
        isPromo: src.isPromo,
        canonicalUrl: null,
        indexable: src.indexable,
        createdBy: session.staffId,
        now: iso(now),
      });
      productCategoriesRepo.setExtra(db, newId, src.categoryId, productCategoriesRepo.listExtra(db, productId));
      if (src.seoTitle !== null || src.seoDescription !== null) productsAdminRepo.upsertSeo(db, newId, { title: src.seoTitle, description: src.seoDescription }, now);
      db.prepare('INSERT INTO product_attributes (product_id, attribute_id, value, sort, value_num) SELECT ?, attribute_id, value, sort, value_num FROM product_attributes WHERE product_id = ?').run(newId, productId);
      db.prepare('INSERT INTO product_images (product_id, url_source, path, variants, alt, sort) SELECT ?, url_source, path, variants, alt, sort FROM product_images WHERE product_id = ?').run(newId, productId);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'product.duplicate', entity: 'product', entityId: newId, after: { from: productId, slug, published: false } }, { db, now });
      return { id: newId, slug };
    });
    clearCategoryImageCache();
    return result;
  },

  /**
   * Выгрузка отфильтрованных товаров в CSV (UTF-8 с BOM, «;»): нужны products.read И export.run; закупочная колонка — только с products.cost.
   * Проверки, подсчёт и запись в аудит выполняются сразу; строки отдаёт генератор порциями по 500 (ключевая пагинация).
   */
  exportCsv(session: StaffSession | null, filter: ProductFilter, opts: Opts = {}): { total: number; chunks: Generator<string, void, void> } {
    requireAny(session, READ);
    if (!hasPermission(session, 'export.run')) throw new ForbiddenError('Недостаточно прав для выгрузки');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const f = filterOf(filter);
    const total = countProducts(db, f);
    if (total > MAX_EXPORT_ROWS) throw new ValidationError(`Под фильтр попало ${total} товаров: в выгрузку попадает не больше ${MAX_EXPORT_ROWS}. Сузьте фильтр.`);
    const cost = hasPermission(session, 'products.cost');
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'product.export', entity: 'product', after: { total, filter: filterToParams(f), cost } }, { db, now });
    function* chunks(): Generator<string, void, void> {
      yield CSV_BOM + exportHeader(cost);
      let after = 0;
      let sent = 0;
      while (sent < MAX_EXPORT_ROWS) {
        const batch = exportBatch(db, f, after, EXPORT_BATCH);
        if (batch.length === 0) return;
        yield batch.map((r) => exportLine(r, cost)).join('');
        sent += batch.length;
        after = batch[batch.length - 1]!.id;
      }
    }
    return { total, chunks: chunks() };
  },
};
