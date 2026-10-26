/*
 * Выгрузка товаров в CSV (UTF-8 с BOM, разделитель «;»). Колонки и заголовки совпадают с полями импорта, поэтому файл
 * можно загрузить обратно. Это выгрузка каталога, а не резервная копия базы. Закупочная цена — только если вызывающий
 * подтвердил право products.cost. Строки отдаются порциями по 500 (ключевая пагинация по id).
 */
import { CSV_BOM, csvCell, rublesText, selectProductIds, type ProductFilter } from '@/domain/catalog/products-list';
import type { Db } from '@/server/db/connection';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { ATTR_PREFIX, FIELD_BY_KEY, FIELDS, isAttrField, attrCode, type Mapping } from './fields';
import { MAX_EXPORT_ROWS } from './limits';

const BATCH = 500;
export const COST_HEADER = 'Закупочная цена';

type Column = { header: string; field: string };

/** Колонки выгрузки: по умолчанию все поля + характеристики, у которых есть значения; с сопоставлением — как в нём (в обратную сторону). */
export function exportColumns(db: Db, opts: { withCost: boolean; mapping?: Mapping }): Column[] {
  let cols: Column[];
  if (opts.mapping) {
    cols = Object.entries(opts.mapping)
      .filter(([, f]) => f !== '' && (FIELD_BY_KEY.has(f) || isAttrField(f)))
      .map(([header, field]) => ({ header, field }));
  } else {
    cols = FIELDS.map((f) => ({ header: f.label, field: f.key }));
    const attrs = db
      .prepare('SELECT d.code, d.name FROM attribute_definitions d WHERE EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.attribute_id = d.id) ORDER BY d.sort, d.id LIMIT 100')
      .all() as { code: string; name: string }[];
    for (const a of attrs) cols.push({ header: `${ATTR_PREFIX}${a.code}`, field: `${ATTR_PREFIX}${a.code}` });
  }
  if (opts.withCost) cols.push({ header: COST_HEADER, field: 'cost' });
  return cols;
}

type Row = {
  id: number;
  sku: string | null;
  external_id: string;
  name: string;
  slug: string;
  price_kopecks: number;
  old_price_kopecks: number | null;
  stock_qty: number;
  stock_tracked: number;
  category_id: number;
  brand_name: string | null;
  barcode: string | null;
  description: string | null;
  published: number;
  hidden_by_admin: number;
  purchase_price_kopecks: number | null;
};

export function exportProductsCsv(db: Db, filter: ProductFilter, opts: { withCost: boolean; mapping?: Mapping }): { total: number; chunks: Generator<string, void, void> } {
  const ids = selectProductIds(db, filter, MAX_EXPORT_ROWS + 1);
  if (ids.length > MAX_EXPORT_ROWS) throw new Error(`Под фильтр попало больше ${MAX_EXPORT_ROWS} товаров — сузьте фильтр`);
  const cols = exportColumns(db, opts);
  const cats = new Map(categoriesRepo.listAll(db).map((c) => [c.id, c]));
  const pathOf = (id: number): string => {
    const names: string[] = [];
    for (let cur = cats.get(id), n = 0; cur && n < 20; cur = cur.parentId === null ? undefined : cats.get(cur.parentId), n++) names.unshift(cur.name);
    return names.join(' > ');
  };
  const attrDefs = new Map((db.prepare('SELECT id, code FROM attribute_definitions').all() as { id: number; code: string }[]).map((d) => [d.id, d.code]));

  function* chunks(): Generator<string, void, void> {
    yield CSV_BOM + cols.map((c) => csvCell(c.header)).join(';') + '\r\n';
    for (let i = 0; i < ids.length; i += BATCH) {
      const part = JSON.stringify(ids.slice(i, i + BATCH));
      const rows = db
        .prepare(
          `SELECT p.id, p.sku, p.external_id, p.name, p.slug, p.price_kopecks, p.old_price_kopecks, p.stock_qty, p.stock_tracked, p.category_id, b.name AS brand_name,
             p.barcode, p.description, p.published, p.hidden_by_admin, p.purchase_price_kopecks
           FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id IN (SELECT value FROM json_each(?)) ORDER BY p.id`,
        )
        .all(part) as Row[];
      const images = new Map<number, string[]>();
      for (const r of db.prepare('SELECT product_id, url_source FROM product_images WHERE product_id IN (SELECT value FROM json_each(?)) ORDER BY product_id, sort, id').all(part) as { product_id: number; url_source: string }[]) {
        images.set(r.product_id, [...(images.get(r.product_id) ?? []), r.url_source]);
      }
      const attrs = new Map<number, Map<string, string>>();
      for (const r of db.prepare('SELECT product_id, attribute_id, value FROM product_attributes WHERE product_id IN (SELECT value FROM json_each(?)) ORDER BY sort, id').all(part) as { product_id: number; attribute_id: number; value: string }[]) {
        const code = attrDefs.get(r.attribute_id);
        if (!code) continue;
        const m = attrs.get(r.product_id) ?? new Map<string, string>();
        if (!m.has(code)) m.set(code, r.value);
        attrs.set(r.product_id, m);
      }
      let out = '';
      for (const r of rows) {
        const cells = cols.map((c): string | number | null => {
          if (isAttrField(c.field)) return attrs.get(r.id)?.get(attrCode(c.field)) ?? null;
          switch (c.field) {
            case 'sku': return r.sku;
            case 'externalId': return r.external_id;
            case 'name': return r.name;
            case 'slug': return r.slug;
            case 'price': return rublesText(r.price_kopecks);
            case 'oldPrice': return r.old_price_kopecks === null ? null : rublesText(r.old_price_kopecks);
            case 'stock': return r.stock_tracked === 1 ? r.stock_qty : null;
            case 'category': return pathOf(r.category_id);
            case 'brand': return r.brand_name;
            case 'barcode': return r.barcode;
            case 'description': return r.description;
            case 'published': return r.published === 1 && r.hidden_by_admin === 0 ? 'да' : 'нет';
            case 'images': return (images.get(r.id) ?? []).join(' | ') || null;
            case 'cost': return r.purchase_price_kopecks === null ? null : rublesText(r.purchase_price_kopecks);
            default: return null;
          }
        });
        out += cells.map(csvCell).join(';') + '\r\n';
      }
      yield out;
    }
  }
  return { total: ids.length, chunks: chunks() };
}
