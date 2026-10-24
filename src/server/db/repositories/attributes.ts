import { coerceLenient, isAttributeType, type AttributeType } from '@/domain/catalog/attribute-types';
import type { Db } from '../connection';
import { ensureFold, likeContains } from '../fold';

export type AttributeValue = { name: string; value: string };

export type AttributeDef = {
  id: number;
  code: string;
  name: string;
  type: AttributeType;
  unit: string | null;
  required: boolean;
  filterable: boolean;
  comparable: boolean;
  sort: number;
  /** Ограничение по категориям; пусто — применима ко всем. */
  categoryIds: number[];
  /** Допустимые значения (тип list), по порядку. */
  allowedValues: string[];
};

export type AttributeListRow = Omit<AttributeDef, 'categoryIds' | 'allowedValues'> & {
  productCount: number;
  categoryCount: number;
  allowedCount: number;
};

type DefRaw = {
  id: number;
  code: string;
  name: string;
  type: string;
  unit: string | null;
  required: number;
  filterable: number;
  comparable: number;
  sort: number;
};

const DEF_COLUMNS = 'd.id, d.code, d.name, d.type, d.unit, d.required, d.filterable, d.comparable, d.sort';

function mapBase(r: DefRaw): Omit<AttributeDef, 'categoryIds' | 'allowedValues'> {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: isAttributeType(r.type) ? r.type : 'string',
    unit: r.unit,
    required: r.required === 1,
    filterable: r.filterable === 1,
    comparable: r.comparable === 1,
    sort: r.sort,
  };
}

export type NewAttribute = {
  code: string;
  name: string;
  type: AttributeType;
  unit: string | null;
  required: boolean;
  filterable: boolean;
  comparable: boolean;
  sort: number;
};

export type AttributeListQuery = {
  q?: string;
  type?: AttributeType;
  filterable?: boolean;
  sort: 'name' | 'code' | 'type' | 'sort' | 'products';
  dir: 'asc' | 'desc';
  limit: number;
  offset: number;
};

const LIST_SORTS: Record<AttributeListQuery['sort'], string> = {
  name: 'rts_fold(d.name)',
  code: 'd.code',
  type: 'd.type',
  sort: 'd.sort',
  products: 'product_count',
};

export type StoredProductValue = { rowId: number; productId: number; value: string; valueNum: number | null };

export const attributesRepo = {
  /** Характеристики товара в исходном порядке. comparableOnly — только участвующие в сравнении. */
  listByProduct(db: Db, productId: number, opts: { comparableOnly?: boolean } = {}): AttributeValue[] {
    return db
      .prepare(
        `SELECT d.name AS name, a.value AS value FROM product_attributes a
         JOIN attribute_definitions d ON d.id = a.attribute_id
         WHERE a.product_id = ? ${opts.comparableOnly ? 'AND d.comparable = 1' : ''} ORDER BY a.sort, a.id`,
      )
      .all(productId) as AttributeValue[];
  },

  /**
   * Полностью заменяет характеристики товара (импорт, 1С); определения (имена) создаются при первом использовании.
   * Значения приводятся к типу характеристики МЯГКО: подходящее нормализуется, неподходящее сохраняется как есть (данные не теряются).
   */
  replaceForProduct(db: Db, productId: number, attrs: AttributeValue[]): void {
    db.prepare('DELETE FROM product_attributes WHERE product_id = ?').run(productId);
    const upsert = db.prepare('INSERT INTO attribute_definitions (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id, type');
    const insert = db.prepare('INSERT INTO product_attributes (product_id, attribute_id, value, value_num, sort) VALUES (?, ?, ?, ?, ?)');
    const allowedCache = new Map<number, string[]>();
    attrs.forEach((a, sort) => {
      const def = upsert.get(a.name) as { id: number; type: string };
      const type = isAttributeType(def.type) ? def.type : 'string';
      let allowed: string[] = [];
      if (type === 'list') {
        const cached = allowedCache.get(def.id);
        allowed = cached ?? this.allowedValues(db, def.id);
        allowedCache.set(def.id, allowed);
      }
      const v = coerceLenient(type, a.value, allowed);
      insert.run(productId, def.id, v.text, v.num, sort);
    });
  },

  countDefinitions(db: Db): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM attribute_definitions').get() as { n: number }).n;
  },

  // ---- справочник характеристик (админка) ----

  list(db: Db, q: AttributeListQuery): { rows: AttributeListRow[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    ensureFold(db);
    if (q.q) {
      where.push(String.raw`(rts_fold(d.name) LIKE ? ESCAPE '\' OR d.code LIKE ? ESCAPE '\')`);
      const like = likeContains(q.q);
      params.push(like, like);
    }
    if (q.type) {
      where.push('d.type = ?');
      params.push(q.type);
    }
    if (q.filterable !== undefined) {
      where.push('d.filterable = ?');
      params.push(q.filterable ? 1 : 0);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM attribute_definitions d ${w}`).get(...params) as { n: number }).n;
    const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
    const rows = db
      .prepare(
        `SELECT ${DEF_COLUMNS},
           (SELECT COUNT(DISTINCT pa.product_id) FROM product_attributes pa WHERE pa.attribute_id = d.id) AS product_count,
           (SELECT COUNT(*) FROM attribute_categories ac WHERE ac.attribute_id = d.id) AS category_count,
           (SELECT COUNT(*) FROM attribute_allowed_values av WHERE av.attribute_id = d.id) AS allowed_count
         FROM attribute_definitions d ${w}
         ORDER BY ${LIST_SORTS[q.sort]} ${dir}, d.sort, rts_fold(d.name), d.id
         LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as (DefRaw & { product_count: number; category_count: number; allowed_count: number })[];
    return {
      total,
      rows: rows.map((r) => ({ ...mapBase(r), productCount: r.product_count, categoryCount: r.category_count, allowedCount: r.allowed_count })),
    };
  },

  /** Все определения (для выпадающих списков: фильтры, объединение). Без счётчиков. */
  listAll(db: Db): Omit<AttributeDef, 'categoryIds' | 'allowedValues'>[] {
    ensureFold(db);
    const rows = db.prepare(`SELECT ${DEF_COLUMNS} FROM attribute_definitions d ORDER BY d.sort, rts_fold(d.name), d.id`).all() as DefRaw[];
    return rows.map(mapBase);
  },

  findById(db: Db, id: number): AttributeDef | undefined {
    const r = db.prepare(`SELECT ${DEF_COLUMNS} FROM attribute_definitions d WHERE d.id = ?`).get(id) as DefRaw | undefined;
    return r && { ...mapBase(r), categoryIds: this.categoryIds(db, id), allowedValues: this.allowedValues(db, id) };
  },

  findByCode(db: Db, code: string): { id: number } | undefined {
    return db.prepare('SELECT id FROM attribute_definitions WHERE code = ?').get(code) as { id: number } | undefined;
  },

  findByName(db: Db, name: string): { id: number } | undefined {
    return db.prepare('SELECT id FROM attribute_definitions WHERE name = ?').get(name) as { id: number } | undefined;
  },

  insert(db: Db, a: NewAttribute): number {
    // Триггер создаёт фильтр по умолчанию; код задаём сразу.
    const r = db
      .prepare('INSERT INTO attribute_definitions (name, code, type, unit, required, filterable, comparable, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(a.name, a.code, a.type, a.unit, a.required ? 1 : 0, a.filterable ? 1 : 0, a.comparable ? 1 : 0, a.sort) as { id: number };
    return r.id;
  },

  update(db: Db, id: number, a: Partial<NewAttribute>): void {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const put = (col: string, v: string | number | null) => {
      sets.push(`${col} = ?`);
      params.push(v);
    };
    if (a.name !== undefined) put('name', a.name);
    if (a.code !== undefined) put('code', a.code);
    if (a.type !== undefined) put('type', a.type);
    if (a.unit !== undefined) put('unit', a.unit);
    if (a.required !== undefined) put('required', a.required ? 1 : 0);
    if (a.filterable !== undefined) put('filterable', a.filterable ? 1 : 0);
    if (a.comparable !== undefined) put('comparable', a.comparable ? 1 : 0);
    if (a.sort !== undefined) put('sort', a.sort);
    if (sets.length === 0) return;
    db.prepare(`UPDATE attribute_definitions SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  },

  delete(db: Db, id: number): void {
    db.prepare('DELETE FROM attribute_definitions WHERE id = ?').run(id);
  },

  categoryIds(db: Db, id: number): number[] {
    return (db.prepare('SELECT category_id FROM attribute_categories WHERE attribute_id = ? ORDER BY category_id').all(id) as { category_id: number }[]).map((r) => r.category_id);
  },

  setCategories(db: Db, id: number, categoryIds: number[]): void {
    db.prepare('DELETE FROM attribute_categories WHERE attribute_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO attribute_categories (attribute_id, category_id) VALUES (?, ?)');
    for (const c of categoryIds) ins.run(id, c);
  },

  allowedValues(db: Db, id: number): string[] {
    return (db.prepare('SELECT value FROM attribute_allowed_values WHERE attribute_id = ? ORDER BY sort, id').all(id) as { value: string }[]).map((r) => r.value);
  },

  setAllowedValues(db: Db, id: number, values: string[]): void {
    db.prepare('DELETE FROM attribute_allowed_values WHERE attribute_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO attribute_allowed_values (attribute_id, value, sort) VALUES (?, ?, ?)');
    values.forEach((v, i) => ins.run(id, v, i));
  },

  /** Сколько товаров имеют значение этой характеристики. */
  productCount(db: Db, id: number): number {
    return (db.prepare('SELECT COUNT(DISTINCT product_id) AS n FROM product_attributes WHERE attribute_id = ?').get(id) as { n: number }).n;
  },

  /** Различные значения со счётчиком товаров (для подсказок и преобразования типа). */
  distinctValues(db: Db, id: number, limit: number): { value: string; count: number }[] {
    return db
      .prepare('SELECT value, COUNT(*) AS count FROM product_attributes WHERE attribute_id = ? GROUP BY value ORDER BY count DESC, value LIMIT ?')
      .all(id, limit) as { value: string; count: number }[];
  },

  /** Все сохранённые значения характеристики (для преобразования типа). */
  storedValues(db: Db, id: number): StoredProductValue[] {
    return (db.prepare('SELECT id, product_id, value, value_num FROM product_attributes WHERE attribute_id = ? ORDER BY id').all(id) as { id: number; product_id: number; value: string; value_num: number | null }[]).map(
      (r) => ({ rowId: r.id, productId: r.product_id, value: r.value, valueNum: r.value_num }),
    );
  },

  updateStored(db: Db, rowId: number, value: string, valueNum: number | null): void {
    db.prepare('UPDATE product_attributes SET value = ?, value_num = ? WHERE id = ?').run(value, valueNum, rowId);
  },

  clearNumeric(db: Db, id: number): void {
    db.prepare('UPDATE product_attributes SET value_num = NULL WHERE attribute_id = ?').run(id);
  },

  /** Значения товара с определениями (для редактирования вручную). */
  valuesOfProduct(db: Db, productId: number): { attributeId: number; value: string }[] {
    return (db.prepare('SELECT attribute_id, value FROM product_attributes WHERE product_id = ? ORDER BY sort, id').all(productId) as { attribute_id: number; value: string }[]).map((r) => ({
      attributeId: r.attribute_id,
      value: r.value,
    }));
  },

  /** Задаёт (или заменяет) значение одной характеристики товара; значение уже проверено строгим разбором. */
  setProductValue(db: Db, productId: number, attributeId: number, value: string, valueNum: number | null): void {
    const existing = db.prepare('SELECT id FROM product_attributes WHERE product_id = ? AND attribute_id = ? ORDER BY id').all(productId, attributeId) as { id: number }[];
    if (existing.length > 0) {
      db.prepare('UPDATE product_attributes SET value = ?, value_num = ? WHERE id = ?').run(value, valueNum, existing[0]!.id);
      for (const extra of existing.slice(1)) db.prepare('DELETE FROM product_attributes WHERE id = ?').run(extra.id);
      return;
    }
    const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM product_attributes WHERE product_id = ?').get(productId) as { s: number }).s;
    db.prepare('INSERT INTO product_attributes (product_id, attribute_id, value, value_num, sort) VALUES (?, ?, ?, ?, ?)').run(productId, attributeId, value, valueNum, sort);
  },

  removeProductValue(db: Db, productId: number, attributeId: number): void {
    db.prepare('DELETE FROM product_attributes WHERE product_id = ? AND attribute_id = ?').run(productId, attributeId);
  },

  /**
   * Объединение дублей: значения source переходят к target (у товара, где значение target уже есть, значение source отбрасывается),
   * фильтр source удаляется, определение source — тоже. Возвращает число перенесённых и отброшенных значений.
   */
  merge(db: Db, sourceId: number, targetId: number): { moved: number; dropped: number } {
    const dropped = db
      .prepare('DELETE FROM product_attributes WHERE attribute_id = ? AND product_id IN (SELECT product_id FROM product_attributes WHERE attribute_id = ?)')
      .run(sourceId, targetId).changes;
    const moved = db.prepare('UPDATE product_attributes SET attribute_id = ? WHERE attribute_id = ?').run(targetId, sourceId).changes;
    db.prepare('DELETE FROM attribute_definitions WHERE id = ?').run(sourceId);
    return { moved: Number(moved), dropped: Number(dropped) };
  },
};
