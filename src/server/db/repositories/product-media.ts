import type { Db } from '../connection';
import { imagesRepo, type ImageRow, type ImageVariantRow } from './images';

export const UPLOAD_PREFIX = 'upload:';

/** Фото товара в админке: загруженные (url_source = upload:<файл>) и внешние ссылки импорта. */
export const productMediaRepo = {
  list(db: Db, productId: number): ImageRow[] {
    return imagesRepo.listByProduct(db, productId);
  },

  find(db: Db, productId: number, imageId: number): ImageRow | undefined {
    return imagesRepo.listByProduct(db, productId).find((i) => i.id === imageId);
  },

  /** Добавляет загруженное фото в конец. */
  addUploaded(db: Db, productId: number, f: { path: string; variants: ImageVariantRow[]; alt: string | null }): number {
    const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM product_images WHERE product_id = ?').get(productId) as { s: number }).s;
    const r = db
      .prepare('INSERT INTO product_images (product_id, url_source, path, variants, alt, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(productId, `${UPLOAD_PREFIX}${f.path}`, f.path, JSON.stringify(f.variants), f.alt, sort);
    return Number(r.lastInsertRowid);
  },

  remove(db: Db, imageId: number): void {
    db.prepare('DELETE FROM product_images WHERE id = ?').run(imageId);
  },

  /** Порядок задаётся списком id: позиция в списке = sort. */
  setOrder(db: Db, orderedIds: readonly number[]): void {
    const upd = db.prepare('UPDATE product_images SET sort = ? WHERE id = ?');
    orderedIds.forEach((id, i) => upd.run(i, id));
  },

  setAlt(db: Db, imageId: number, alt: string | null): void {
    db.prepare('UPDATE product_images SET alt = ? WHERE id = ?').run(alt, imageId);
  },

  /** Ссылаются ли на файл ещё какие-то строки (файл можно удалять с диска, только если нет). */
  pathInUse(db: Db, path: string, exceptImageId: number): boolean {
    return db.prepare('SELECT 1 AS x FROM product_images WHERE path = ? AND id <> ? LIMIT 1').get(path, exceptImageId) !== undefined;
  },
};
