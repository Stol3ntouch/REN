import { visibleProductSql } from '@/server/db/repositories/products';
import { getDb, type Db } from '@/server/db/connection';
import { parseVariants, type ImageVariantRow } from '@/server/db/repositories/images';
import { toCatalogImage, type ImageSize } from './images';
import type { CatalogImage } from './types';

/** Живёт в памяти процесса; фото категорий меняются редко (импорт, правка товара). */
export const CATEGORY_IMAGES_TTL_MS = 5 * 60_000;

type Pick1 = { path: string | null; variants: ImageVariantRow[]; urlSource: string };
type Snapshot = { at: number; names: Map<number, string>; picks: Map<number, Pick1> };

const cache = new WeakMap<Db, Snapshot>();

const generations = new WeakMap<Db, number>();
// Счётчик на globalThis: страницы и админка Next собираются в разные бандлы, модульная переменная у них своя,
// и сброс из импорта не дошёл бы до витрины.
const genRef = globalThis as unknown as { __rtsCategoryImageGen?: number };
const currentGeneration = () => genRef.__rtsCategoryImageGen ?? 0;

/** Сбросить кэш всех баз (тесты, ручной сброс после импорта). */
export function clearCategoryImageCache(): void {
  genRef.__rtsCategoryImageGen = currentGeneration() + 1;
}

/**
 * Один проход по всем категориям: первое фото опубликованного товара поддерева.
 * Порядок выбора детерминирован: товар в наличии, затем меньший id товара, затем порядок фото.
 */
function build(db: Db, now: number): Snapshot {
  const cats = db.prepare('SELECT id, parent_id, name, image_path, image_variants FROM categories').all() as { id: number; parent_id: number | null; name: string; image_path: string | null; image_variants: string | null }[];
  const rows = db
    .prepare(
      `SELECT p.category_id AS cid, p.in_stock AS in_stock, p.id AS pid, i.path AS path, i.variants AS variants, i.url_source AS url
         FROM products p
         JOIN product_images i ON i.id = (SELECT id FROM product_images WHERE product_id = p.id ORDER BY sort, id LIMIT 1)
        WHERE ${visibleProductSql('p')}
        ORDER BY p.in_stock DESC, p.id`,
    )
    .all() as { cid: number; in_stock: number; pid: number; path: string | null; variants: string | null; url: string }[];

  const parent = new Map(cats.map((c) => [c.id, c.parent_id]));
  const picks = new Map<number, Pick1>();
  // Строки уже упорядочены по приоритету: первая, дошедшая до категории, и побеждает.
  for (const r of rows) {
    const pick: Pick1 = { path: r.path, variants: parseVariants(r.variants), urlSource: r.url };
    const seen = new Set<number>();
    for (let id: number | null | undefined = r.cid; id != null && !seen.has(id); id = parent.get(id)) {
      seen.add(id);
      if (!picks.has(id)) picks.set(id, pick);
    }
  }
  // собственное изображение категории (C06, загружено в админке) главнее фото товара; подкатегории без своего берут фото товаров
  for (const c of cats) if (c.image_path) picks.set(c.id, { path: c.image_path, variants: parseVariants(c.image_variants), urlSource: '' });
  return { at: now, names: new Map(cats.map((c) => [c.id, c.name])), picks };
}

function snapshot(db: Db, now: number): Snapshot {
  const hit = cache.get(db);
  if (hit && generations.get(db) === currentGeneration() && now - hit.at <= CATEGORY_IMAGES_TTL_MS && now >= hit.at) return hit;
  const fresh = build(db, now);
  cache.set(db, fresh);
  generations.set(db, currentGeneration());
  return fresh;
}

type Opts = { db?: Db; size?: ImageSize; now?: number };

/** Фото для пачки категорий: id → фото или null (нет ни одного фото у опубликованных товаров поддерева). */
export function getCategoryImages(ids: number[], opts: Opts = {}): Map<number, CatalogImage | null> {
  const snap = snapshot(opts.db ?? getDb(), opts.now ?? Date.now());
  const size = opts.size ?? 'card';
  const out = new Map<number, CatalogImage | null>();
  for (const id of ids) {
    const pick = snap.picks.get(id);
    const name = snap.names.get(id) ?? '';
    if (!pick) {
      out.set(id, null);
      continue;
    }
    // alt — название категории, а не товара: фото здесь иллюстрирует раздел.
    out.set(id, { ...toCatalogImage({ ...pick, alt: null }, size, name), alt: name });
  }
  return out;
}

export function getCategoryImage(categoryId: number, opts: Opts = {}): CatalogImage | null {
  return getCategoryImages([categoryId], opts).get(categoryId) ?? null;
}
