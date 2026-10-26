import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { clearCategoryImageCache } from '@/domain/catalog/category-images';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { categoriesRepo, computeEffectiveHidden, type CategoryRow } from '@/server/db/repositories/categories';
import { NotFoundError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

export type CategoryVisibilityRow = {
  id: number;
  name: string;
  slug: string;
  depth: number;
  /** Скрыта самой кнопкой. */
  hidden: boolean;
  /** Скрыта сама или через родителя: именно так её видит покупатель. */
  effectiveHidden: boolean;
  /** Все товары поддерева (любого состояния) — ориентир, сколько позиций «живёт» в разделе. */
  productCount: number;
  hasSeoText: boolean;
};

export type VisibilityImpact = { categories: number; products: number };

const idSchema = z.number({ error: 'Категория не найдена' }).int('Категория не найдена').min(1, 'Категория не найдена');
const flagSchema = z.boolean({ error: 'Неверное действие' });

const bad = (e: z.ZodError): ValidationError => new ValidationError(e.issues[0]?.message ?? 'Проверьте введённые данные');

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw bad(r.error);
  return r.data;
}

/** Товары по категориям: все и «видимые по остальным признакам» (опубликован и не скрыт вручную). */
function productCounts(db: Db): { all: Map<number, number>; live: Map<number, number> } {
  const all = new Map<number, number>();
  const live = new Map<number, number>();
  const rows = db
    .prepare('SELECT category_id AS id, COUNT(*) AS n, SUM(CASE WHEN published = 1 AND hidden_by_admin = 0 THEN 1 ELSE 0 END) AS live FROM products GROUP BY category_id')
    .all() as { id: number; n: number; live: number }[];
  for (const r of rows) {
    all.set(r.id, r.n);
    live.set(r.id, r.live);
  }
  return { all, live };
}

/** Дерево «родитель перед детьми» с глубиной; сироты (родитель не найден) считаются корневыми. */
function ordered(rows: CategoryRow[]): { row: CategoryRow; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const byParent = new Map<number | null, CategoryRow[]>();
  for (const r of rows) {
    const key = r.parentId !== null && ids.has(r.parentId) ? r.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  const out: { row: CategoryRow; depth: number }[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ row: r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function subtreeIds(rows: CategoryRow[], rootId: number): Set<number> {
  const out = new Set<number>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) {
      if (r.parentId !== null && out.has(r.parentId) && !out.has(r.id)) {
        out.add(r.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Скрытие категорий каталога (F6). Чтение — catalog.read, запись — categories.write (только admin).
 * Флаг catalog.manualEdit не нужен: видимость — решение о контенте сайта, а не правка данных 1С.
 * Импорт hidden_by_admin не трогает; effective_hidden (скрытость с учётом родителей) пересчитывается здесь и в конце импорта.
 */
export const categoryVisibilityOps = {
  list(session: StaffSession | null, opts: Opts = {}): CategoryVisibilityRow[] {
    requirePermission(session, 'catalog.read');
    const db = opts.db ?? getDb();
    const rows = categoriesRepo.listAll(db);
    const counts = productCounts(db).all;
    const total = (id: number): number => [...subtreeIds(rows, id)].reduce((s, c) => s + (counts.get(c) ?? 0), 0);
    return ordered(rows).map(({ row, depth }) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      depth,
      hidden: row.hiddenByAdmin,
      effectiveHidden: row.effectiveHidden,
      productCount: total(row.id),
      hasSeoText: (row.seoText ?? '').trim() !== '',
    }));
  },

  /**
   * Что изменится для покупателя, если категорию скрыть (hidden=true) или показать: сколько категорий поддерева
   * сменят видимость и сколько товаров (опубликованных и не скрытых вручную) появится или пропадёт. Для окна подтверждения.
   */
  impact(session: StaffSession | null, id: number, hidden: boolean, opts: Opts = {}): VisibilityImpact {
    requirePermission(session, 'categories.write');
    const db = opts.db ?? getDb();
    const rows = categoriesRepo.listAll(db);
    if (!rows.some((r) => r.id === id)) throw new NotFoundError('Категория не найдена');
    const before = computeEffectiveHidden(rows.map((r) => ({ id: r.id, parentId: r.parentId, hiddenByAdmin: r.hiddenByAdmin, inactive: !r.active })));
    const after = computeEffectiveHidden(rows.map((r) => ({ id: r.id, parentId: r.parentId, hiddenByAdmin: r.id === id ? hidden : r.hiddenByAdmin, inactive: !r.active })));
    const live = productCounts(db).live;
    let categories = 0;
    let products = 0;
    for (const r of rows) {
      if (before.has(r.id) === after.has(r.id)) continue;
      categories++;
      products += live.get(r.id) ?? 0;
    }
    return { categories, products };
  },

  /**
   * Скрыть (hidden=true) или показать категорию вместе с подкатегориями. Атомарно: признак, пересчёт и аудит в одной транзакции.
   * Повтор того же действия — { changed: false } без записи в аудит. Аудит category.visibility (id категории, признак).
   */
  setHidden(session: StaffSession | null, id: unknown, hidden: unknown, opts: Opts = {}): { changed: boolean } {
    requirePermission(session, 'categories.write');
    const categoryId = parse(idSchema, id);
    const flag = parse(flagSchema, hidden);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const changed = withTransaction(db, () => {
      const current = categoriesRepo.findById(db, categoryId);
      if (!current) throw new NotFoundError('Категория не найдена');
      if (current.hiddenByAdmin === flag) return false;
      categoriesRepo.setHiddenByAdmin(db, categoryId, flag);
      categoriesRepo.recomputeEffectiveHidden(db);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'category.visibility', entity: 'category', entityId: categoryId, before: { hidden: !flag }, after: { hidden: flag } },
        { db, now },
      );
      return true;
    });
    if (changed) clearCategoryImageCache(); // плитки категорий кэшируют первое фото — сбросить сразу
    return { changed };
  },
};
