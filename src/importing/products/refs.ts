/*
 * Справочники для разбора ссылок строки CSV: категории (путь «А > Б» или код), бренды, характеристики, ключи товаров.
 * Один раз читаются из БД и дальше ищутся в памяти.
 */
import type { Db } from '@/server/db/connection';
import { foldText } from '@/server/db/fold';
import { attributesRepo, type AttributeDef } from '@/server/db/repositories/attributes';
import { brandsRepo, type BrandRow } from '@/server/db/repositories/brands';
import { categoriesRepo, type CategoryRow } from '@/server/db/repositories/categories';

export type CatalogRefs = {
  byExternalId: Map<string, CategoryRow>;
  bySlug: Map<string, CategoryRow>;
  byName: Map<string, CategoryRow[]>;
  children: Map<number | null, Map<string, CategoryRow>>;
  brands: Map<string, BrandRow>;
  attrs: Map<string, AttributeDef>;
};

export function loadRefs(db: Db): CatalogRefs {
  const cats = categoriesRepo.listAll(db);
  const refs: CatalogRefs = { byExternalId: new Map(), bySlug: new Map(), byName: new Map(), children: new Map(), brands: new Map(), attrs: new Map() };
  for (const c of cats) {
    if (!refs.byExternalId.has(c.externalId)) refs.byExternalId.set(c.externalId, c);
    refs.bySlug.set(c.slug, c);
    const key = foldText(c.name.trim());
    refs.byName.set(key, [...(refs.byName.get(key) ?? []), c]);
    const siblings = refs.children.get(c.parentId) ?? new Map<string, CategoryRow>();
    if (!siblings.has(key)) siblings.set(key, c);
    refs.children.set(c.parentId, siblings);
  }
  for (const b of brandsRepo.listAll(db, { includeArchived: true })) if (!refs.brands.has(foldText(b.name.trim()))) refs.brands.set(foldText(b.name.trim()), b);
  for (const d of attributesRepo.listAll(db)) {
    const full = attributesRepo.findById(db, d.id);
    if (full) refs.attrs.set(d.code.toLowerCase(), full);
  }
  return refs;
}

export type CategoryResolution =
  | { kind: 'found'; id: number; category: CategoryRow }
  | { kind: 'missing'; /** Существующий родитель, под которым создаётся цепочка. */ parentId: number | null; /** Названия категорий, которых нет. */ missing: string[] }
  | { kind: 'ambiguous'; message: string };

export const CATEGORY_SEPARATOR = '>';

/** Категория по тексту ячейки: путь «Родитель > Дочерняя», код (внешний ID), slug или единственная категория с таким названием. */
export function resolveCategory(refs: CatalogRefs, text: string): CategoryResolution {
  const t = text.trim();
  if (t.includes(CATEGORY_SEPARATOR)) {
    const parts = t
      .split(CATEGORY_SEPARATOR)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return { kind: 'ambiguous', message: 'Пустой путь категории' };
    let parent: number | null = null;
    let last: CategoryRow | undefined;
    for (let i = 0; i < parts.length; i++) {
      const child: CategoryRow | undefined = refs.children.get(parent)?.get(foldText(parts[i]!));
      if (!child) return { kind: 'missing', parentId: parent, missing: parts.slice(i) };
      parent = child.id;
      last = child;
    }
    return { kind: 'found', id: last!.id, category: last! };
  }
  const byCode = refs.byExternalId.get(t) ?? refs.bySlug.get(t);
  if (byCode) return { kind: 'found', id: byCode.id, category: byCode };
  const named = refs.byName.get(foldText(t)) ?? [];
  if (named.length === 1) return { kind: 'found', id: named[0]!.id, category: named[0]! };
  if (named.length > 1) return { kind: 'ambiguous', message: `Категория «${t}» неоднозначна (есть в нескольких местах) — укажите путь «Родитель > Дочерняя» или код` };
  return { kind: 'missing', parentId: null, missing: [t] };
}

/** Ключи существующих товаров для поиска по артикулу, внешнему ID и штрихкоду. */
export type ProductKeys = { bySku: Map<string, number[]>; byExt: Map<string, number[]>; byBarcode: Map<string, number[]> };

export function loadProductKeys(db: Db): ProductKeys {
  const keys: ProductKeys = { bySku: new Map(), byExt: new Map(), byBarcode: new Map() };
  const add = (m: Map<string, number[]>, k: string | null, id: number) => {
    if (k === null || k === '') return;
    const list = m.get(k);
    if (list) list.push(id);
    else m.set(k, [id]);
  };
  for (const r of db.prepare('SELECT id, sku, external_id, barcode FROM products').all() as { id: number; sku: string | null; external_id: string; barcode: string | null }[]) {
    add(keys.bySku, r.sku, r.id);
    add(keys.byExt, r.external_id, r.id);
    add(keys.byBarcode, r.barcode, r.id);
  }
  return keys;
}
