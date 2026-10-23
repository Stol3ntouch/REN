import type { Db } from '../connection';

/**
 * Выборки id товаров для блоков главной (T08). Карточки по этим id строит витрина (cardsByIds).
 * Только опубликованные товары. SQL популярности приходит снаружи (источник подключает T05).
 */
const PUBLISHED = 'p.published = 1';
const ISO_DATE = "p.first_seen_at GLOB '[0-9][0-9][0-9][0-9]-*'";
const ids = (rows: unknown[]): number[] => (rows as { id: number }[]).map((r) => r.id);

export const homeProductsRepo = {
  countPublished(db: Db): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${PUBLISHED}`).get() as { n: number }).n;
  },
  /** Товары, впервые увидевшие каталог не раньше sinceIso (ISO-строка; нечитаемые даты игнорируются). */
  countNewSince(db: Db, sinceIso: string): number {
    const sql = `SELECT COUNT(*) AS n FROM products p WHERE ${PUBLISHED} AND ${ISO_DATE} AND p.first_seen_at >= ?`;
    return (db.prepare(sql).get(sinceIso) as { n: number }).n;
  },
  newIds(db: Db, sinceIso: string, limit: number): number[] {
    const sql = `SELECT p.id FROM products p WHERE ${PUBLISHED} AND ${ISO_DATE} AND p.first_seen_at >= ?
      ORDER BY p.first_seen_at DESC, p.id DESC LIMIT ?`;
    return ids(db.prepare(sql).all(sinceIso, limit));
  },
  featuredIds(db: Db, limit: number): number[] {
    return ids(db.prepare(`SELECT p.id FROM products p WHERE ${PUBLISHED} AND p.featured = 1 ORDER BY p.id LIMIT ?`).all(limit));
  },
  /** Товары с реальной скидочной ценой (скидка действует при discount < price), самые большие скидки первыми. */
  discountedIds(db: Db, limit: number): number[] {
    const sql = `SELECT p.id FROM products p
      WHERE ${PUBLISHED} AND p.discount_price_kopecks IS NOT NULL AND p.discount_price_kopecks > 0 AND p.discount_price_kopecks < p.price_kopecks
      ORDER BY (p.price_kopecks - p.discount_price_kopecks) * 1.0 / p.price_kopecks DESC, p.id LIMIT ?`;
    return ids(db.prepare(sql).all(limit));
  },
  /** Самые продаваемые: popularitySql — подзапрос «SELECT id, SUM(...) AS units …»; только товары с продажами. */
  topSoldIds(db: Db, popularitySql: string, limit: number): number[] {
    const sql = `SELECT p.id FROM products p JOIN (${popularitySql}) pop ON pop.id = p.id
      WHERE ${PUBLISHED} AND pop.units > 0 ORDER BY pop.units DESC, p.id LIMIT ?`;
    return ids(db.prepare(sql).all(limit));
  },
};
