import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { filterSchema, validateFilterConfig, type FilterInput, type FilterParsed } from '@/domain/catalog/filters';
import { zodToValidation } from '@/domain/catalog/validation';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { filtersRepo, type FilterListQuery, type FilterListRow } from '@/server/db/repositories/filters';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

const snapshot = (f: { kind: string; attributeId: number | null; label: string; widget: string; sort: number; enabled: boolean; config: object; categoryIds: number[] }) => ({
  kind: f.kind,
  attributeId: f.attributeId,
  label: f.label,
  widget: f.widget,
  sort: f.sort,
  enabled: f.enabled,
  config: f.config,
  categoryIds: [...f.categoryIds].sort((a, b) => a - b),
});

function diff(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>) {
  const keys = (Object.keys(after) as (keyof typeof after)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return { keys, before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: Object.fromEntries(keys.map((k) => [k, after[k]])) };
}

/** Разбор + проверка конфигурации + уникальность + существование категорий. Возвращает готовые данные. */
function prepare(db: Db, input: unknown, selfId: number | null): FilterParsed {
  const parsed = filterSchema.safeParse(input);
  if (!parsed.success) throw zodToValidation(parsed.error);
  const f = parsed.data;
  const attribute = f.attributeId === null ? null : attributesRepo.findById(db, f.attributeId);
  const problems = validateFilterConfig(f, attribute ? { type: attribute.type, filterable: attribute.filterable } : null);
  if (problems.length > 0) throw new ValidationError(problems[0] as string, { form: problems });
  if (f.kind === 'attribute') {
    const dup = filtersRepo.findByAttribute(db, f.attributeId as number);
    if (dup && dup.id !== selfId) throw new ConflictError('Для этой характеристики фильтр уже создан');
  } else {
    const dup = filtersRepo.findByKind(db, f.kind);
    if (dup && dup.id !== selfId) throw new ConflictError('Фильтр такого вида уже есть: у каждого вида (кроме характеристики) он один');
  }
  if (f.categoryIds.length > 0) {
    const known = new Set(categoriesRepo.listAll(db).map((c) => c.id));
    if (f.categoryIds.some((c) => !known.has(c))) throw new ValidationError('Указана несуществующая категория', { categoryIds: ['Указана несуществующая категория'] });
  }
  return f;
}

/**
 * Фильтры каталога (G27). Чтение — catalog.read, запись — catalog.write (старый ключ; точные права появятся с C02).
 * Включённые фильтры в заданном порядке определяют панель фильтров витрины (domain/catalog/facets).
 */
export const filterOps = {
  list(session: StaffSession | null, query: FilterListQuery, opts: Opts = {}) {
    requirePermission(session, 'catalog.read');
    return filtersRepo.list(opts.db ?? getDb(), query);
  },

  get(session: StaffSession | null, id: number, opts: Opts = {}): FilterListRow | null {
    requirePermission(session, 'catalog.read');
    return filtersRepo.findById(opts.db ?? getDb(), id) ?? null;
  },

  create(session: StaffSession | null, input: FilterInput, opts: Opts = {}): { id: number } {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const f = prepare(db, input, null);
      const id = filtersRepo.insert(db, f);
      filtersRepo.setCategories(db, id, f.categoryIds);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'filter.create', entity: 'filter', entityId: id, after: snapshot({ ...f, categoryIds: f.categoryIds }) }, { db, now });
      return { id };
    });
  },

  update(session: StaffSession | null, id: number, input: FilterInput, opts: Opts = {}): { changed: string[] } {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const current = filtersRepo.findById(db, id);
      if (!current) throw new NotFoundError('Фильтр не найден');
      const f = prepare(db, input, id);
      filtersRepo.update(db, id, f);
      filtersRepo.setCategories(db, id, f.categoryIds);
      const d = diff(snapshot(current), snapshot(f));
      if (d.keys.length > 0) {
        const action = d.keys.length === 1 && d.keys[0] === 'enabled' ? 'filter.toggle' : 'filter.update';
        audit.record({ actorId: session.staffId, actorType: 'staff', action, entity: 'filter', entityId: id, before: d.before, after: d.after }, { db, now });
      }
      return { changed: d.keys.map(String) };
    });
  },

  setEnabled(session: StaffSession | null, id: number, enabled: boolean, opts: Opts = {}): void {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const current = filtersRepo.findById(db, id);
      if (!current) throw new NotFoundError('Фильтр не найден');
      if (current.enabled === enabled) return;
      filtersRepo.setEnabled(db, id, enabled);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'filter.toggle', entity: 'filter', entityId: id, before: { enabled: current.enabled }, after: { enabled } }, { db, now });
    });
  },

  /** Порядок показа: id в нужной последовательности получают sort 10, 20, 30… (остальные фильтры не затрагиваются). */
  reorder(session: StaffSession | null, orderedIds: number[], opts: Opts = {}): void {
    requirePermission(session, 'catalog.write');
    const ids = [...new Set(orderedIds)];
    if (ids.length === 0 || ids.some((i) => !Number.isInteger(i) || i < 1)) throw new ValidationError('Не указаны фильтры для сортировки');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before: Record<string, number> = {};
      const after: Record<string, number> = {};
      ids.forEach((id, i) => {
        const current = filtersRepo.findById(db, id);
        if (!current) throw new NotFoundError('Фильтр не найден');
        before[String(id)] = current.sort;
        after[String(id)] = (i + 1) * 10;
        filtersRepo.setSort(db, id, (i + 1) * 10);
      });
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'filter.reorder', entity: 'filter', before, after }, { db, now });
    });
  },

  remove(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const current = filtersRepo.findById(db, id);
      if (!current) throw new NotFoundError('Фильтр не найден');
      filtersRepo.delete(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'filter.delete', entity: 'filter', entityId: id, before: snapshot(current) }, { db, now });
    });
  },
};
