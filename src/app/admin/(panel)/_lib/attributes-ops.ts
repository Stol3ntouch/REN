import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { ancestorsOf, appliesToCategory, attributeCodeFromName, attributeSchema, coerceValue, suggestType, type AttributeInput, type AttributeParsed, type AttributeType } from '@/domain/catalog/attributes';
import { zodToValidation } from '@/domain/catalog/validation';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { attributesRepo, type AttributeDef, type AttributeListQuery } from '@/server/db/repositories/attributes';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { filtersRepo } from '@/server/db/repositories/filters';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

const snapshot = (a: AttributeDef) => ({
  code: a.code,
  name: a.name,
  type: a.type,
  unit: a.unit,
  required: a.required,
  filterable: a.filterable,
  comparable: a.comparable,
  sort: a.sort,
  categoryIds: a.categoryIds,
  allowedValues: a.allowedValues,
});

function diff(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>) {
  const keys = (Object.keys(after) as (keyof typeof after)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return { keys, before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: Object.fromEntries(keys.map((k) => [k, after[k]])) };
}

function parse(input: unknown): AttributeParsed {
  const parsed = attributeSchema.safeParse(input);
  if (!parsed.success) throw zodToValidation(parsed.error);
  return parsed.data;
}

function assertCategories(db: Db, ids: number[]): void {
  if (ids.length === 0) return;
  const known = new Set(categoriesRepo.listAll(db).map((c) => c.id));
  const bad = ids.filter((i) => !known.has(i));
  if (bad.length > 0) throw new ValidationError('Указана несуществующая категория', { categoryIds: ['Указана несуществующая категория'] });
}

/** Описание отказа преобразования: сколько значений не подходит и несколько примеров. */
function conversionFailure(label: string, bad: { value: string; error: string }[], total: number): ValidationError {
  const examples = [...new Set(bad.map((b) => `«${b.value}»`))].slice(0, 5).join(', ');
  const msg = `Нельзя сменить тип на «${label}»: не подходят значения (${bad.length} из ${total}), например ${examples}. Исправьте их или оставьте прежний тип`;
  return new ValidationError(msg, { type: [msg] });
}

const TYPE_LABEL: Record<AttributeType, string> = { string: 'Строка', number: 'Число', boolean: 'Да / нет', list: 'Список значений', date: 'Дата' };

/**
 * Приводит сохранённые значения характеристики к типу (nextType, nextAllowed): сначала проверка ВСЕХ значений, потом запись.
 * Хоть одно значение не подходит — ничего не меняется (ValidationError). Строка — всегда допустима и обнуляет число.
 */
function convertStoredValues(db: Db, id: number, nextType: AttributeType, nextAllowed: string[]): number {
  const stored = attributesRepo.storedValues(db, id);
  if (nextType === 'string') {
    attributesRepo.clearNumeric(db, id);
    return stored.length;
  }
  const planned: { rowId: number; text: string; num: number | null }[] = [];
  const bad: { value: string; error: string }[] = [];
  for (const row of stored) {
    const r = coerceValue(nextType, row.value, nextAllowed);
    if (r.ok) planned.push({ rowId: row.rowId, text: r.value.text, num: r.value.num });
    else bad.push({ value: row.value, error: r.error });
  }
  if (bad.length > 0) throw conversionFailure(TYPE_LABEL[nextType], bad, stored.length);
  for (const p of planned) attributesRepo.updateStored(db, p.rowId, p.text, p.num);
  return planned.length;
}

/**
 * Характеристики (G26). Чтение — catalog.read, запись — catalog.write (старый ключ; точные права появятся с C02).
 * Данные прежнего импорта не меняются: тип по умолчанию «Строка»; числовой тип включается явно и только если все значения — числа.
 */
export const attributeOps = {
  list(session: StaffSession | null, query: AttributeListQuery, opts: Opts = {}) {
    requirePermission(session, 'catalog.read');
    return attributesRepo.list(opts.db ?? getDb(), query);
  },

  options(session: StaffSession | null, opts: Opts = {}) {
    requirePermission(session, 'catalog.read');
    return attributesRepo.listAll(opts.db ?? getDb());
  },

  get(session: StaffSession | null, id: number, opts: Opts = {}): (AttributeDef & { productCount: number; suggestedType: AttributeType; examples: { value: string; count: number }[] }) | null {
    requirePermission(session, 'catalog.read');
    const db = opts.db ?? getDb();
    const a = attributesRepo.findById(db, id);
    if (!a) return null;
    const examples = attributesRepo.distinctValues(db, id, 200);
    return { ...a, productCount: attributesRepo.productCount(db, id), suggestedType: suggestType(examples.map((e) => e.value)), examples: examples.slice(0, 12) };
  },

  /** Характеристики, применимые к категории (для формы товара): с учётом ограничения по категориям и предков. */
  forCategory(session: StaffSession | null, categoryId: number, opts: Opts = {}): AttributeDef[] {
    requirePermission(session, 'catalog.read');
    const db = opts.db ?? getDb();
    const parents = new Map(categoriesRepo.listAll(db).map((c) => [c.id, c.parentId]));
    const chain = ancestorsOf(categoryId, parents);
    const out: AttributeDef[] = [];
    for (const d of attributesRepo.listAll(db)) {
      const full = attributesRepo.findById(db, d.id);
      if (full && appliesToCategory(full.categoryIds, chain)) out.push(full);
    }
    return out;
  },

  create(session: StaffSession | null, input: AttributeInput, opts: Opts = {}): { id: number } {
    requirePermission(session, 'catalog.write');
    const data = parse(input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      if (attributesRepo.findByName(db, data.name)) throw new ConflictError('Характеристика с таким названием уже есть');
      let code = data.code;
      if (code === '') {
        const base = attributeCodeFromName(data.name);
        code = base;
        for (let n = 2; attributesRepo.findByCode(db, code); n++) code = `${base}_${n}`.slice(0, 64);
      } else if (attributesRepo.findByCode(db, code)) {
        throw new ConflictError('Системный код уже занят');
      }
      assertCategories(db, data.categoryIds);
      const id = attributesRepo.insert(db, { code, name: data.name, type: data.type, unit: data.unit, required: data.required, filterable: data.filterable, comparable: data.comparable, sort: data.sort });
      attributesRepo.setCategories(db, id, data.categoryIds);
      attributesRepo.setAllowedValues(db, id, data.type === 'list' ? data.allowedValues : []);
      // Триггер БД создал фильтр по умолчанию (флажки); вид отображения меняет администратор.
      if (!data.filterable) {
        const f = filtersRepo.findByAttribute(db, id);
        if (f) filtersRepo.setEnabled(db, f.id, false);
      }
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'attribute.create', entity: 'attribute', entityId: id, after: snapshot(attributesRepo.findById(db, id) as AttributeDef) }, { db, now });
      return { id };
    });
  },

  update(session: StaffSession | null, id: number, input: AttributeInput, opts: Opts = {}): { changed: string[]; converted: number } {
    requirePermission(session, 'catalog.write');
    const data = parse(input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const current = attributesRepo.findById(db, id);
      if (!current) throw new NotFoundError('Характеристика не найдена');
      const sameName = attributesRepo.findByName(db, data.name);
      if (sameName && sameName.id !== id) throw new ConflictError('Характеристика с таким названием уже есть');
      const code = data.code === '' ? current.code : data.code;
      const sameCode = attributesRepo.findByCode(db, code);
      if (sameCode && sameCode.id !== id) throw new ConflictError('Системный код уже занят');
      assertCategories(db, data.categoryIds);

      const allowed = data.type === 'list' ? data.allowedValues : [];
      let converted = 0;
      const typeChanged = current.type !== data.type;
      const allowedChanged = data.type === 'list' && JSON.stringify(current.allowedValues) !== JSON.stringify(allowed);
      if (typeChanged || allowedChanged) converted = convertStoredValues(db, id, data.type, allowed);

      attributesRepo.update(db, id, { code, name: data.name, type: data.type, unit: data.unit, required: data.required, filterable: data.filterable, comparable: data.comparable, sort: data.sort });
      attributesRepo.setCategories(db, id, data.categoryIds);
      attributesRepo.setAllowedValues(db, id, allowed);

      // Фильтр характеристики следует за ней: подпись (если не менялась вручную), допустимый виджет, наличие самого фильтра.
      const filter = filtersRepo.findByAttribute(db, id);
      if (!filter) {
        if (data.filterable && !current.filterable) {
          filtersRepo.insert(db, { kind: 'attribute', attributeId: id, label: data.name, widget: 'checkbox', sort: 100, enabled: true, config: {} });
        }
      } else {
        if (filter.label === current.name && data.name !== current.name) filtersRepo.setLabelByAttribute(db, id, current.name, data.name);
        if (filter.widget === 'range' && data.type !== 'number') filtersRepo.setWidgetByAttribute(db, id, 'checkbox');
      }

      const d = diff(snapshot(current), snapshot(attributesRepo.findById(db, id) as AttributeDef));
      if (d.keys.length > 0) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'attribute.update', entity: 'attribute', entityId: id, before: d.before, after: { ...d.after, ...(typeChanged ? { convertedValues: converted } : {}) } }, { db, now });
      return { changed: d.keys.map(String), converted };
    });
  },

  /** Удаление: без значений у товаров — сразу; со значениями — только с withValues (значения удаляются вместе с характеристикой). */
  remove(session: StaffSession | null, id: number, opts: Opts & { withValues?: boolean } = {}): { deletedValues: number } {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const a = attributesRepo.findById(db, id);
      if (!a) throw new NotFoundError('Характеристика не найдена');
      const products = attributesRepo.productCount(db, id);
      if (products > 0 && !opts.withValues) {
        throw new ConflictError(`У характеристики есть значения у товаров: ${products}. Объедините её с другой характеристикой или удалите вместе со значениями`);
      }
      let deletedValues = 0;
      if (products > 0) deletedValues = Number(db.prepare('DELETE FROM product_attributes WHERE attribute_id = ?').run(id).changes);
      attributesRepo.delete(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'attribute.delete', entity: 'attribute', entityId: id, before: snapshot(a), after: products > 0 ? { deletedValues, products } : undefined }, { db, now });
      return { deletedValues };
    });
  },

  /** Объединение дублей: значения source переходят в target, source удаляется. Типы должны совпадать. */
  merge(session: StaffSession | null, sourceId: number, targetId: number, opts: Opts = {}): { moved: number; dropped: number } {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      if (sourceId === targetId) throw new ValidationError('Выберите другую характеристику для объединения');
      const source = attributesRepo.findById(db, sourceId);
      const target = attributesRepo.findById(db, targetId);
      if (!source || !target) throw new NotFoundError('Характеристика не найдена');
      if (source.type !== target.type) throw new ValidationError(`Объединять можно характеристики одного типа (${TYPE_LABEL[source.type]} и ${TYPE_LABEL[target.type]} — разные)`);
      if (target.type === 'list') {
        const union = [...target.allowedValues];
        for (const v of source.allowedValues) if (!union.some((u) => u.toLowerCase() === v.toLowerCase())) union.push(v);
        attributesRepo.setAllowedValues(db, targetId, union);
      }
      const r = attributesRepo.merge(db, sourceId, targetId);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'attribute.merge', entity: 'attribute', entityId: targetId, before: { source: snapshot(source), target: snapshot(target) }, after: { movedValues: r.moved, droppedValues: r.dropped } },
        { db, now },
      );
      return r;
    });
  },

  /**
   * Значение характеристики у товара вручную (форма товара, C04): строгая проверка типа на сервере.
   * Пустое значение снимает характеристику (обязательную — нельзя).
   */
  setProductValue(session: StaffSession | null, productId: number, attributeId: number, raw: string, opts: Opts = {}): { text: string | null } {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const a = attributesRepo.findById(db, attributeId);
      if (!a) throw new NotFoundError('Характеристика не найдена');
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw new NotFoundError('Товар не найден');
      const before = attributesRepo.valuesOfProduct(db, productId).find((v) => v.attributeId === attributeId)?.value ?? null;
      if (raw.trim() === '') {
        if (a.required) throw new ValidationError(`«${a.name}» — обязательная характеристика`, { value: ['Обязательное поле'] });
        attributesRepo.removeProductValue(db, productId, attributeId);
        if (before !== null) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'attribute.value', entity: 'product', entityId: productId, before: { [a.code]: before }, after: { [a.code]: null } }, { db, now });
        return { text: null };
      }
      const r = coerceValue(a.type, raw, a.allowedValues);
      if (!r.ok) throw new ValidationError(`${a.name}: ${r.error}`, { value: [r.error] });
      attributesRepo.setProductValue(db, productId, attributeId, r.value.text, r.value.num);
      if (before !== r.value.text) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'attribute.value', entity: 'product', entityId: productId, before: { [a.code]: before }, after: { [a.code]: r.value.text } }, { db, now });
      return { text: r.value.text };
    });
  },
};
