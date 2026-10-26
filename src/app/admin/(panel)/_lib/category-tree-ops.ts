import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { clearCategoryImageCache } from '@/domain/catalog/category-images';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { categoriesRepo, type CategoryRow } from '@/server/db/repositories/categories';
import { NotFoundError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

export type TreeNode = {
  id: number;
  name: string;
  slug: string;
  parentId: number | null;
  /** Глаз: скрыта самим переключателем (hidden_by_admin). */
  hidden: boolean;
  /** Скрыта сама, неактивна или скрыта через родителя: так её видит покупатель. */
  effectiveHidden: boolean;
  active: boolean;
  hasChildren: boolean;
  /** Опубликованные и не скрытые вручную товары категории вместе с подкатегориями (каждый товар — один раз). */
  productCount: number;
};

export type CategorySearchHit = { id: number; name: string; path: string; parentId: number | null; effectiveHidden: boolean };

const idSchema = z.number({ error: 'Категория не найдена' }).int('Категория не найдена').min(1, 'Категория не найдена');
const parentSchema = idSchema.nullable();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? 'Проверьте введённые данные');
  return r.data;
}

/** Всё дерево одним чтением: карта детей в порядке показа. */
function childMap(rows: CategoryRow[]): Map<number | null, CategoryRow[]> {
  const ids = new Set(rows.map((r) => r.id));
  const out = new Map<number | null, CategoryRow[]>();
  for (const r of rows) {
    const key = r.parentId !== null && ids.has(r.parentId) ? r.parentId : null;
    out.set(key, [...(out.get(key) ?? []), r]);
  }
  return out;
}

/** Идентификаторы категории и всех её потомков (с защитой от цикла в битых данных). */
export function subtreeOf(rows: CategoryRow[], rootId: number): Set<number> {
  const kids = childMap(rows);
  const out = new Set<number>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as number;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of kids.get(id) ?? []) stack.push(c.id);
  }
  return out;
}

/** Товары поддерева: id категории → число различных живых товаров (категории, подкатегорий). */
export function liveCounts(db: Db, rows: CategoryRow[]): { byCategory: Map<number, number>; total: number } {
  const direct = new Map<number, Set<number>>();
  const all = new Set<number>();
  for (const l of categoriesRepo.liveProductLinks(db)) {
    let s = direct.get(l.categoryId);
    if (!s) direct.set(l.categoryId, (s = new Set()));
    s.add(l.productId);
    all.add(l.productId);
  }
  const kids = childMap(rows);
  const byCategory = new Map<number, number>();
  const union = (id: number, seen: Set<number>): Set<number> => {
    const acc = new Set(direct.get(id) ?? []);
    if (seen.has(id)) return acc;
    seen.add(id);
    for (const c of kids.get(id) ?? []) for (const p of union(c.id, seen)) acc.add(p);
    byCategory.set(id, acc.size);
    return acc;
  };
  for (const r of rows) if (!byCategory.has(r.id)) union(r.id, new Set());
  return { byCategory, total: all.size };
}

const node = (r: CategoryRow, kids: Map<number | null, CategoryRow[]>, counts: Map<number, number>): TreeNode => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  parentId: r.parentId,
  hidden: r.hiddenByAdmin,
  effectiveHidden: r.effectiveHidden,
  active: r.active,
  hasChildren: (kids.get(r.id) ?? []).length > 0,
  productCount: counts.get(r.id) ?? 0,
});

/**
 * Дерево категорий админки: уровни по запросу, поиск, перенос и порядок. Чтение — catalog.read, запись — categories.write.
 * Скрытое и неактивное показывается (в админке видно всё), но помечено.
 */
export const categoryTreeOps = {
  /** Подкатегории родителя (null — корневые) в порядке показа и общий счётчик «Все категории». */
  children(session: StaffSession | null, parent: unknown, opts: Opts = {}): { nodes: TreeNode[]; total: number } {
    requirePermission(session, 'catalog.read');
    const parentId = parse(parentSchema, parent);
    const db = opts.db ?? getDb();
    const rows = categoriesRepo.listAll(db);
    if (parentId !== null && !rows.some((r) => r.id === parentId)) throw new NotFoundError('Категория не найдена');
    const kids = childMap(rows);
    const { byCategory, total } = liveCounts(db, rows);
    return { nodes: (kids.get(parentId) ?? []).map((r) => node(r, kids, byCategory)), total };
  },

  /** Поиск по названию (без учёта регистра) с путём «Родитель › Дочерняя». Не более 30 результатов. */
  search(session: StaffSession | null, text: unknown, opts: Opts = {}): CategorySearchHit[] {
    requirePermission(session, 'catalog.read');
    const q = (typeof text === 'string' ? text : '').trim().toLowerCase().slice(0, 100);
    if (q === '') return [];
    const rows = categoriesRepo.listAll(opts.db ?? getDb());
    const byId = new Map(rows.map((r) => [r.id, r]));
    const pathOf = (r: CategoryRow): string => {
      const names: string[] = [];
      const seen = new Set<number>();
      for (let cur: CategoryRow | undefined = r; cur && !seen.has(cur.id); cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) {
        seen.add(cur.id);
        names.unshift(cur.name);
      }
      return names.join(' › ');
    };
    return rows
      .filter((r) => r.name.toLowerCase().includes(q))
      .slice(0, 30)
      .map((r) => ({ id: r.id, name: r.name, path: pathOf(r), parentId: r.parentId, effectiveHidden: r.effectiveHidden }));
  },

  /** Цепочка предков от корня до категории включительно (чтобы раскрыть дерево до выбранной). */
  path(session: StaffSession | null, id: unknown, opts: Opts = {}): number[] {
    requirePermission(session, 'catalog.read');
    const categoryId = parse(idSchema, id);
    const rows = categoriesRepo.listAll(opts.db ?? getDb());
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (!byId.has(categoryId)) throw new NotFoundError('Категория не найдена');
    const chain: number[] = [];
    const seen = new Set<number>();
    for (let cur = byId.get(categoryId); cur && !seen.has(cur.id); cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) {
      seen.add(cur.id);
      chain.unshift(cur.id);
    }
    return chain;
  },

  /**
   * Поставить категорию под родителя (null — в корень) перед соседом beforeId (null — в конец).
   * Перенос в себя и в потомков запрещён (проверка цикла на сервере). Переставляет позиции соседей;
   * приоритет перенесённой берётся у соседа, перед которым она встала, чтобы порядок не определял приоритет.
   * Смена родителя закрепляет его за ручной правкой (импорт YML не вернёт старого).
   */
  place(session: StaffSession | null, id: unknown, target: { parentId: unknown; beforeId?: unknown }, opts: Opts = {}): { changed: boolean } {
    requirePermission(session, 'categories.write');
    const categoryId = parse(idSchema, id);
    const parentId = parse(parentSchema, target.parentId);
    const beforeId = target.beforeId === undefined || target.beforeId === null ? null : parse(idSchema, target.beforeId);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const result = withTransaction(db, () => {
      const rows = categoriesRepo.listAll(db);
      const me = rows.find((r) => r.id === categoryId);
      if (!me) throw new NotFoundError('Категория не найдена');
      if (parentId !== null) {
        if (!rows.some((r) => r.id === parentId)) throw new NotFoundError('Родительская категория не найдена');
        if (subtreeOf(rows, categoryId).has(parentId)) throw new ValidationError('Нельзя перенести категорию в саму себя или в её подкатегорию');
      }
      const siblings = (childMap(rows).get(parentId) ?? []).filter((r) => r.id !== categoryId);
      let index = siblings.length;
      if (beforeId !== null) {
        index = siblings.findIndex((r) => r.id === beforeId);
        if (index < 0) throw new ValidationError('Соседняя категория должна быть в том же родителе');
      }
      const before = { parentId: me.parentId, sort: me.sort, priority: me.priority };
      const priority = beforeId !== null ? (siblings[index] as CategoryRow).priority : (siblings.at(-1)?.priority ?? 0);
      const movedParent = me.parentId !== parentId;
      if (!movedParent && (childMap(rows).get(parentId) ?? []).findIndex((r) => r.id === categoryId) === index && me.priority === priority) return false;
      const ordered = [...siblings.slice(0, index), me, ...siblings.slice(index)];
      if (movedParent) categoriesRepo.updateCard(db, categoryId, { parentId });
      ordered.forEach((r, i) => {
        if (r.id === categoryId) categoriesRepo.updateCard(db, r.id, { sort: i + 1, priority });
        else if (r.sort !== i + 1) categoriesRepo.setSort(db, r.id, i + 1);
      });
      const after = { parentId, sort: index + 1, priority };
      if (movedParent) categoriesRepo.recomputeEffectiveHidden(db);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: movedParent ? 'category.move' : 'category.reorder', entity: 'category', entityId: categoryId, before, after },
        { db, now },
      );
      return true;
    });
    if (result) clearCategoryImageCache();
    return { changed: result };
  },

  /** Клавиатурная замена перетаскиванию: на одну позицию выше или ниже среди соседей. */
  step(session: StaffSession | null, id: unknown, direction: unknown, opts: Opts = {}): { changed: boolean } {
    requirePermission(session, 'categories.write');
    const categoryId = parse(idSchema, id);
    const dir = parse(z.enum(['up', 'down'], { error: 'Неверное направление' }), direction);
    const db = opts.db ?? getDb();
    const rows = categoriesRepo.listAll(db);
    const me = rows.find((r) => r.id === categoryId);
    if (!me) throw new NotFoundError('Категория не найдена');
    const siblings = childMap(rows).get(me.parentId !== null && rows.some((r) => r.id === me.parentId) ? me.parentId : null) ?? [];
    const i = siblings.findIndex((r) => r.id === categoryId);
    if (dir === 'up') {
      if (i <= 0) return { changed: false };
      return categoryTreeOps.place(session, categoryId, { parentId: me.parentId, beforeId: (siblings[i - 1] as CategoryRow).id }, opts);
    }
    if (i < 0 || i >= siblings.length - 1) return { changed: false };
    return categoryTreeOps.place(session, categoryId, { parentId: me.parentId, beforeId: siblings[i + 2]?.id ?? null }, opts);
  },
};

// --- Массовые действия (множественное скрытие и перенос)

/** Не больше стольких категорий за одно массовое действие (дерево магазина — сотни, а не тысячи). */
export const MAX_BULK_CATEGORIES = 500;

const bulkSchema = z.object({
  ids: z
    .array(idSchema, { error: 'Выберите категории' })
    .min(1, 'Выберите категории')
    .max(MAX_BULK_CATEGORIES, `Выбрано слишком много категорий (не больше ${MAX_BULK_CATEGORIES})`),
  action: z.discriminatedUnion(
    'type',
    [z.object({ type: z.literal('hide') }), z.object({ type: z.literal('show') }), z.object({ type: z.literal('move'), parentId: idSchema.nullable() })],
    { error: 'Неверное действие' },
  ),
});

export type CategoryBulkAction = z.input<typeof bulkSchema>['action'];
export type CategoryBulkReport = {
  /** Сколько различных категорий выбрано. */
  total: number;
  changed: number;
  /** Уже в нужном состоянии, не найдены или перенос невозможен. */
  skipped: number;
  /** Сколько категорий поддеревьев сменили видимость для покупателя помимо выбранных (каскад effective_hidden). */
  cascaded: number;
  skippedItems: { id: number; reason: string }[];
};

export const categoryBulkOps = {
  /**
   * Идентификаторы для «выбрать все»: scope level — подкатегории родителя (null — корневые), subtree — категория и все её потомки.
   * Нужна только для чтения (catalog.read); само действие проверяет categories.write.
   */
  selectionIds(session: StaffSession | null, scope: { level: unknown } | { subtree: unknown }, opts: Opts = {}): number[] {
    requirePermission(session, 'catalog.read');
    const rows = categoriesRepo.listAll(opts.db ?? getDb());
    if ('level' in scope) {
      const parentId = parse(parentSchema, scope.level);
      if (parentId !== null && !rows.some((r) => r.id === parentId)) throw new NotFoundError('Категория не найдена');
      return (childMap(rows).get(parentId) ?? []).map((r) => r.id);
    }
    const rootId = parse(idSchema, scope.subtree);
    if (!rows.some((r) => r.id === rootId)) throw new NotFoundError('Категория не найдена');
    return [...subtreeOf(rows, rootId)];
  },

  /**
   * Скрыть / показать / перенести выбранные категории одной транзакцией. Видимость пересчитывается один раз для всего дерева
   * (скрытие родителя каскадом скрывает потомков; потомок, скрытый сам, остаётся скрытым после показа родителя).
   * Невозможное (уже в состоянии, не найдена, перенос в себя или потомка) пропускается и попадает в отчёт — остальное выполняется.
   * В журнал — одна запись category.bulk с числом изменённых и их id.
   */
  run(session: StaffSession | null, ids: unknown, action: unknown, opts: Opts = {}): CategoryBulkReport {
    requirePermission(session, 'categories.write');
    const parsed = bulkSchema.safeParse({ ids, action });
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Проверьте введённые данные');
    const unique = [...new Set(parsed.data.ids)];
    const act = parsed.data.action;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const report = withTransaction(db, () => {
      let rows = categoriesRepo.listAll(db);
      const hiddenBefore = new Set(rows.filter((r) => r.effectiveHidden).map((r) => r.id));
      if (act.type === 'move' && act.parentId !== null && !rows.some((r) => r.id === act.parentId)) throw new NotFoundError('Родительская категория не найдена');
      const skippedItems: { id: number; reason: string }[] = [];
      const done: number[] = [];
      for (const id of unique) {
        const me = rows.find((r) => r.id === id);
        if (!me) {
          skippedItems.push({ id, reason: 'Категория не найдена' });
          continue;
        }
        if (act.type === 'move') {
          if (act.parentId !== null && subtreeOf(rows, id).has(act.parentId)) {
            skippedItems.push({ id, reason: 'Нельзя перенести в себя или в свою подкатегорию' });
            continue;
          }
          if (me.parentId === act.parentId) {
            skippedItems.push({ id, reason: 'Уже в этой категории' });
            continue;
          }
          categoriesRepo.updateCard(db, id, { parentId: act.parentId, sort: categoriesRepo.nextSort(db, act.parentId) });
          rows = categoriesRepo.listAll(db);
        } else {
          const hide = act.type === 'hide';
          if (me.hiddenByAdmin === hide) {
            skippedItems.push({ id, reason: hide ? 'Уже скрыта' : 'Уже показана' });
            continue;
          }
          categoriesRepo.setHiddenByAdmin(db, id, hide);
        }
        done.push(id);
      }
      let cascaded = 0;
      if (done.length > 0) {
        categoriesRepo.recomputeEffectiveHidden(db);
        const selected = new Set(done);
        for (const r of categoriesRepo.listAll(db)) if (!selected.has(r.id) && r.effectiveHidden !== hiddenBefore.has(r.id)) cascaded++;
        audit.record(
          { actorId: session.staffId, actorType: 'staff', action: 'category.bulk', entity: 'category', after: { action: act, changed: done.length, skipped: skippedItems.length, cascaded, ids: done } },
          { db, now },
        );
      }
      return { total: unique.length, changed: done.length, skipped: skippedItems.length, cascaded, skippedItems } satisfies CategoryBulkReport;
    });
    if (report.changed > 0) clearCategoryImageCache();
    return report;
  },
};
