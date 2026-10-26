import type { Db } from '../connection';
import { parseConfig, type FilterConfig, type FilterKind, type FilterWidget } from './filters';

/** Настроенный фильтр витрины: включён, его характеристика (если есть) участвует в фильтрах. */
export type StorefrontFilter = {
  id: number;
  kind: FilterKind;
  widget: FilterWidget;
  label: string;
  sort: number;
  config: FilterConfig;
  /** Ограничение по категориям; пусто — везде. */
  categoryIds: number[];
  /** Настройки по категориям (C06): показ и порядок в конкретной категории. */
  categorySettings: { categoryId: number; sort: number | null; enabled: boolean }[];
  attribute: { id: number; type: string; unit: string | null } | null;
};

type Raw = {
  id: number;
  kind: string;
  widget: string;
  label: string;
  sort: number;
  config: string;
  category_ids: string | null;
  category_settings: string | null;
  attribute_id: number | null;
  attribute_type: string | null;
  attribute_unit: string | null;
};

function parseSettings(json: string | null): StorefrontFilter['categorySettings'] {
  if (!json) return [];
  try {
    return (JSON.parse(json) as { c: number; s: number | null; e: number }[]).map((x) => ({ categoryId: x.c, sort: x.s, enabled: x.e === 1 }));
  } catch {
    return [];
  }
}

export const facetsConfigRepo = {
  /**
   * Все включённые фильтры в порядке показа ОДНИМ запросом (индекс catalog_filters(enabled, sort)).
   * Фильтр характеристики, у которой снят признак «использовать в фильтрах», не попадает на витрину.
   */
  listEnabled(db: Db): StorefrontFilter[] {
    const rows = db
      .prepare(
        `SELECT f.id, f.kind, f.widget, f.label, f.sort, f.config, f.attribute_id,
            (SELECT group_concat(fc.category_id) FROM catalog_filter_categories fc WHERE fc.filter_id = f.id) AS category_ids,
            (SELECT json_group_array(json_object('c', s.category_id, 's', s.sort, 'e', s.enabled)) FROM category_filter_settings s WHERE s.filter_id = f.id) AS category_settings,
            d.type AS attribute_type, d.unit AS attribute_unit
         FROM catalog_filters f LEFT JOIN attribute_definitions d ON d.id = f.attribute_id
         WHERE f.enabled = 1 AND (f.attribute_id IS NULL OR d.filterable = 1)
         ORDER BY f.sort, f.id`,
      )
      .all() as Raw[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as FilterKind,
      widget: r.widget as FilterWidget,
      label: r.label,
      sort: r.sort,
      config: parseConfig(r.config),
      categoryIds: r.category_ids ? r.category_ids.split(',').map(Number).filter(Number.isInteger) : [],
      categorySettings: parseSettings(r.category_settings),
      attribute: r.attribute_id === null ? null : { id: r.attribute_id, type: r.attribute_type ?? 'string', unit: r.attribute_unit },
    }));
  },
};
