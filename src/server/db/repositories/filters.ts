import type { Db } from '../connection';
import { ensureFold, likeContains } from '../fold';

export const FILTER_KINDS = ['price', 'brand', 'stock', 'attribute', 'category'] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];
export const FILTER_WIDGETS = ['checkbox', 'range', 'select'] as const;
export type FilterWidget = (typeof FILTER_WIDGETS)[number];

/** Правило витрины по умолчанию: характеристика — фильтр категории при ≥3 товарах и ≤30 значениях. */
export type FilterConfig = { minProducts?: number; maxValues?: number };

export type FilterRow = {
  id: number;
  kind: FilterKind;
  attributeId: number | null;
  label: string;
  widget: FilterWidget;
  sort: number;
  enabled: boolean;
  config: FilterConfig;
  /** Ограничение по категориям; пусто — везде. */
  categoryIds: number[];
};

export type FilterListRow = FilterRow & {
  attributeName: string | null;
  attributeType: string | null;
  attributeFilterable: boolean | null;
  attributeUnit: string | null;
};

type Raw = {
  id: number;
  kind: string;
  attribute_id: number | null;
  label: string;
  widget: string;
  sort: number;
  enabled: number;
  config: string;
  category_ids: string | null;
  attribute_name?: string | null;
  attribute_type?: string | null;
  attribute_filterable?: number | null;
  attribute_unit?: string | null;
};

export function parseConfig(json: string): FilterConfig {
  try {
    const v: unknown = JSON.parse(json);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const o = v as Record<string, unknown>;
    const out: FilterConfig = {};
    if (typeof o.minProducts === 'number' && Number.isInteger(o.minProducts)) out.minProducts = o.minProducts;
    if (typeof o.maxValues === 'number' && Number.isInteger(o.maxValues)) out.maxValues = o.maxValues;
    return out;
  } catch {
    return {};
  }
}

function ids(csv: string | null): number[] {
  return csv ? csv.split(',').map(Number).filter(Number.isInteger) : [];
}

const SELECT = `SELECT f.id, f.kind, f.attribute_id, f.label, f.widget, f.sort, f.enabled, f.config,
    (SELECT group_concat(fc.category_id) FROM catalog_filter_categories fc WHERE fc.filter_id = f.id) AS category_ids,
    d.name AS attribute_name, d.type AS attribute_type, d.filterable AS attribute_filterable, d.unit AS attribute_unit
  FROM catalog_filters f LEFT JOIN attribute_definitions d ON d.id = f.attribute_id`;

function map(r: Raw): FilterListRow {
  return {
    id: r.id,
    kind: r.kind as FilterKind,
    attributeId: r.attribute_id,
    label: r.label,
    widget: r.widget as FilterWidget,
    sort: r.sort,
    enabled: r.enabled === 1,
    config: parseConfig(r.config),
    categoryIds: ids(r.category_ids),
    attributeName: r.attribute_name ?? null,
    attributeType: r.attribute_type ?? null,
    attributeFilterable: r.attribute_filterable === undefined || r.attribute_filterable === null ? null : r.attribute_filterable === 1,
    attributeUnit: r.attribute_unit ?? null,
  };
}

export type FilterFields = {
  kind: FilterKind;
  attributeId: number | null;
  label: string;
  widget: FilterWidget;
  sort: number;
  enabled: boolean;
  config: FilterConfig;
};

export type FilterListQuery = {
  q?: string;
  kind?: FilterKind;
  enabled?: boolean;
  limit: number;
  offset: number;
};

export const filtersRepo = {
  list(db: Db, q: FilterListQuery): { rows: FilterListRow[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.q) {
      ensureFold(db);
      where.push(String.raw`(rts_fold(f.label) LIKE ? ESCAPE '\' OR rts_fold(COALESCE(d.name, '')) LIKE ? ESCAPE '\')`);
      const like = likeContains(q.q);
      params.push(like, like);
    }
    if (q.kind) {
      where.push('f.kind = ?');
      params.push(q.kind);
    }
    if (q.enabled !== undefined) {
      where.push('f.enabled = ?');
      params.push(q.enabled ? 1 : 0);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM catalog_filters f LEFT JOIN attribute_definitions d ON d.id = f.attribute_id ${w}`).get(...params) as { n: number }).n;
    const rows = db.prepare(`${SELECT} ${w} ORDER BY f.sort, f.id LIMIT ? OFFSET ?`).all(...params, q.limit, q.offset) as Raw[];
    return { total, rows: rows.map(map) };
  },

  findById(db: Db, id: number): FilterListRow | undefined {
    const r = db.prepare(`${SELECT} WHERE f.id = ?`).get(id) as Raw | undefined;
    return r && map(r);
  },

  findByKind(db: Db, kind: FilterKind): FilterRow | undefined {
    const r = db.prepare(`${SELECT} WHERE f.kind = ? AND f.kind <> 'attribute'`).get(kind) as Raw | undefined;
    return r && map(r);
  },

  findByAttribute(db: Db, attributeId: number): FilterRow | undefined {
    const r = db.prepare(`${SELECT} WHERE f.attribute_id = ?`).get(attributeId) as Raw | undefined;
    return r && map(r);
  },

  insert(db: Db, f: FilterFields): number {
    const r = db
      .prepare('INSERT INTO catalog_filters (kind, attribute_id, label, widget, sort, enabled, config) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(f.kind, f.attributeId, f.label, f.widget, f.sort, f.enabled ? 1 : 0, JSON.stringify(f.config)) as { id: number };
    return r.id;
  },

  update(db: Db, id: number, f: FilterFields): void {
    db.prepare('UPDATE catalog_filters SET kind = ?, attribute_id = ?, label = ?, widget = ?, sort = ?, enabled = ?, config = ? WHERE id = ?').run(
      f.kind,
      f.attributeId,
      f.label,
      f.widget,
      f.sort,
      f.enabled ? 1 : 0,
      JSON.stringify(f.config),
      id,
    );
  },

  setEnabled(db: Db, id: number, enabled: boolean): void {
    db.prepare('UPDATE catalog_filters SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  },

  setSort(db: Db, id: number, sort: number): void {
    db.prepare('UPDATE catalog_filters SET sort = ? WHERE id = ?').run(sort, id);
  },

  setCategories(db: Db, id: number, categoryIds: number[]): void {
    db.prepare('DELETE FROM catalog_filter_categories WHERE filter_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO catalog_filter_categories (filter_id, category_id) VALUES (?, ?)');
    for (const c of categoryIds) ins.run(id, c);
  },

  delete(db: Db, id: number): void {
    db.prepare('DELETE FROM catalog_filters WHERE id = ?').run(id);
  },

  /** Фильтр характеристики, у которой меняется тип, переключаем на допустимый виджет. */
  setWidgetByAttribute(db: Db, attributeId: number, widget: FilterWidget): void {
    db.prepare('UPDATE catalog_filters SET widget = ? WHERE attribute_id = ?').run(widget, attributeId);
  },

  setLabelByAttribute(db: Db, attributeId: number, from: string, to: string): void {
    db.prepare('UPDATE catalog_filters SET label = ? WHERE attribute_id = ? AND label = ?').run(to, attributeId, from);
  },
};
