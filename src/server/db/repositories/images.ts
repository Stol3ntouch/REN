import type { Db } from '../connection';

export type ImageVariantRow = { key: string; width: number; height: number; path: string };

export type ImageRow = {
  id: number;
  productId: number;
  urlSource: string;
  /** Путь относительно data/uploads; null — фото ещё не скачано. */
  path: string | null;
  variants: ImageVariantRow[];
  alt: string | null;
  sort: number;
};

type Raw = { id: number; product_id: number; url_source: string; path: string | null; variants: string | null; alt: string | null; sort: number };

export function parseVariants(json: string | null): ImageVariantRow[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as ImageVariantRow[]) : [];
  } catch {
    return [];
  }
}

function map(r: Raw): ImageRow {
  return { id: r.id, productId: r.product_id, urlSource: r.url_source, path: r.path, variants: parseVariants(r.variants), alt: r.alt, sort: r.sort };
}

export const imagesRepo = {
  listByProduct(db: Db, productId: number): ImageRow[] {
    return (db.prepare('SELECT id, product_id, url_source, path, variants, alt, sort FROM product_images WHERE product_id = ? ORDER BY sort, id').all(productId) as Raw[]).map(map);
  },

  /**
   * Приводит фото товара к списку ссылок: уже скачанные (по url_source) сохраняют path и variants,
   * лишние удаляются, новые добавляются без path.
   */
  replaceForProduct(db: Db, productId: number, urls: string[], alt: string | null): void {
    const existing = new Map(imagesRepo.listByProduct(db, productId).map((i) => [i.urlSource, i]));
    const keep = new Set(urls);
    for (const [url, row] of existing) if (!keep.has(url)) db.prepare('DELETE FROM product_images WHERE id = ?').run(row.id);
    urls.forEach((url, sort) => {
      const row = existing.get(url);
      if (row) db.prepare('UPDATE product_images SET sort = ?, alt = ? WHERE id = ?').run(sort, alt, row.id);
      else db.prepare('INSERT INTO product_images (product_id, url_source, alt, sort) VALUES (?, ?, ?, ?)').run(productId, url, alt, sort);
    });
  },

  /** Записывает результат скачивания: путь основного файла и варианты размеров. */
  setStored(db: Db, id: number, stored: { path: string; variants: ImageVariantRow[] }): void {
    db.prepare('UPDATE product_images SET path = ?, variants = ? WHERE id = ?').run(stored.path, JSON.stringify(stored.variants), id);
  },

  /** Фото, которые ещё не скачаны (path IS NULL), в порядке товара и позиции. */
  listPending(db: Db, productIds?: number[]): ImageRow[] {
    const rows = db.prepare('SELECT id, product_id, url_source, path, variants, alt, sort FROM product_images WHERE path IS NULL ORDER BY product_id, sort, id').all() as Raw[];
    const all = rows.map(map);
    if (!productIds) return all;
    const only = new Set(productIds);
    return all.filter((i) => only.has(i.productId));
  },

  count(db: Db): { total: number; stored: number } {
    const r = db.prepare('SELECT COUNT(*) AS total, COUNT(path) AS stored FROM product_images').get() as { total: number; stored: number };
    return r;
  },
};
