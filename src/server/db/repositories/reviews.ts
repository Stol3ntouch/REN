import type { Db } from '../connection';
import { likeAny } from './content-base';
import { visibleProductSql } from './products';

export type ReviewStatus = 'pending' | 'published' | 'rejected';

export type ReviewRow = {
  id: number;
  productId: number;
  productName: string | null;
  productSlug: string | null;
  rating: number;
  authorName: string;
  body: string;
  status: ReviewStatus;
  createdAt: number;
  moderatedAt: number | null;
  /** Ответ администратора (показывается на витрине под опубликованным отзывом). */
  adminReply: string | null;
  repliedAt: number | null;
  repliedBy: number | null;
};

type Raw = {
  id: number;
  product_id: number;
  product_name: string | null;
  product_slug: string | null;
  rating: number;
  author_name: string;
  body: string;
  status: ReviewStatus;
  created_at: number;
  moderated_at: number | null;
  admin_reply: string | null;
  replied_at: number | null;
  replied_by: number | null;
};

const SELECT = `SELECT v.*, p.name AS product_name, p.slug AS product_slug FROM reviews v LEFT JOIN products p ON p.id = v.product_id`;

const map = (r: Raw): ReviewRow => ({
  id: r.id,
  productId: r.product_id,
  productName: r.product_name,
  productSlug: r.product_slug,
  rating: r.rating,
  authorName: r.author_name,
  body: r.body,
  status: r.status,
  createdAt: r.created_at,
  moderatedAt: r.moderated_at,
  adminReply: r.admin_reply,
  repliedAt: r.replied_at,
  repliedBy: r.replied_by,
});

export type ReviewFilter = {
  status?: ReviewStatus;
  productId?: number;
  rating?: number;
  /** Период по дате отзыва, unix-мс (включительно). */
  from?: number;
  to?: number;
  q?: string;
  sort?: 'created_desc' | 'created_asc' | 'rating_desc' | 'rating_asc';
  limit: number;
  offset: number;
};

const REVIEW_ORDER: Record<NonNullable<ReviewFilter['sort']>, string> = {
  created_desc: 'v.created_at DESC, v.id DESC',
  created_asc: 'v.created_at ASC, v.id ASC',
  rating_desc: 'v.rating DESC, v.created_at DESC, v.id DESC',
  rating_asc: 'v.rating ASC, v.created_at DESC, v.id DESC',
};

export const reviewsRepo = {
  /** Список для админки: фильтры статус/товар/оценка/период, поиск, сортировка, страница. */
  search(db: Db, f: ReviewFilter): { rows: ReviewRow[]; total: number } {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (f.status) {
      conds.push('v.status = ?');
      params.push(f.status);
    }
    if (f.productId) {
      conds.push('v.product_id = ?');
      params.push(f.productId);
    }
    if (f.rating) {
      conds.push('v.rating = ?');
      params.push(f.rating);
    }
    if (f.from !== undefined) {
      conds.push('v.created_at >= ?');
      params.push(f.from);
    }
    if (f.to !== undefined) {
      conds.push('v.created_at <= ?');
      params.push(f.to);
    }
    if (f.q && f.q.trim() !== '') {
      const l = likeAny(db, ['v.author_name', 'v.body', 'p.name'], f.q);
      conds.push(l.sql);
      params.push(...l.params);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM reviews v LEFT JOIN products p ON p.id = v.product_id ${where}`).get(...params) as { n: number }).n;
    const rows = (db.prepare(`${SELECT} ${where} ORDER BY ${REVIEW_ORDER[f.sort ?? 'created_desc']} LIMIT ? OFFSET ?`).all(...params, f.limit, f.offset) as Raw[]).map(map);
    return { rows, total };
  },
  setReply(db: Db, id: number, reply: string | null, by: number | null, now: number): void {
    if (reply === null) db.prepare('UPDATE reviews SET admin_reply = NULL, replied_at = NULL, replied_by = NULL WHERE id = ?').run(id);
    else db.prepare('UPDATE reviews SET admin_reply = ?, replied_at = ?, replied_by = ? WHERE id = ?').run(reply, now, by, id);
  },
  /** Счётчики по статусам (для вкладок). */
  statusCounts(db: Db): Record<ReviewStatus, number> {
    const out: Record<ReviewStatus, number> = { pending: 0, published: 0, rejected: 0 };
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status').all() as { status: ReviewStatus; n: number }[]) out[r.status] = Number(r.n);
    return out;
  },
  /** Товар, на который можно оставить отзыв/вопрос: должен существовать и быть опубликован. */
  findProduct(db: Db, productId: number): { id: number; name: string; slug: string; published: boolean } | null {
    const r = db.prepare(`SELECT p.id, p.name, p.slug, ${visibleProductSql('p')} AS published FROM products p WHERE p.id = ?`).get(productId) as { id: number; name: string; slug: string; published: number } | undefined;
    return r ? { id: r.id, name: r.name, slug: r.slug, published: r.published === 1 } : null;
  },
  insert(db: Db, v: { productId: number; rating: number; authorName: string; body: string; userId?: number | null; guestId?: string | null; now: number }): number {
    const r = db
      .prepare('INSERT INTO reviews (product_id, rating, author_name, body, user_id, guest_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(v.productId, v.rating, v.authorName, v.body, v.userId ?? null, v.guestId ?? null, v.now);
    return Number(r.lastInsertRowid);
  },
  setConsent(db: Db, id: number, consentId: number): void {
    db.prepare('UPDATE reviews SET consent_id = ? WHERE id = ?').run(consentId, id);
  },
  findById(db: Db, id: number): ReviewRow | null {
    const r = db.prepare(`${SELECT} WHERE v.id = ?`).get(id) as Raw | undefined;
    return r ? map(r) : null;
  },
  list(db: Db, f: { status?: ReviewStatus; limit?: number; offset?: number } = {}): ReviewRow[] {
    const sql = `${SELECT} ${f.status ? 'WHERE v.status = ?' : ''} ORDER BY v.created_at DESC, v.id DESC LIMIT ? OFFSET ?`;
    const args: (string | number)[] = f.status ? [f.status] : [];
    return (db.prepare(sql).all(...args, f.limit ?? 100, f.offset ?? 0) as Raw[]).map(map);
  },
  /** Только опубликованные — для витрины. */
  listPublishedByProduct(db: Db, productId: number, limit = 50): ReviewRow[] {
    return (db.prepare(`${SELECT} WHERE v.product_id = ? AND v.status = 'published' ORDER BY v.created_at DESC, v.id DESC LIMIT ?`).all(productId, limit) as Raw[]).map(map);
  },
  setStatus(db: Db, id: number, status: ReviewStatus, by: number | null, now: number): void {
    db.prepare('UPDATE reviews SET status = ?, moderated_by = ?, moderated_at = ? WHERE id = ?').run(status, by, now, id);
  },
  /** Среднее и число ОПУБЛИКОВАННЫХ отзывов. Нет опубликованных — count=0, average=null. */
  publishedStats(db: Db, productId: number): { average: number | null; count: number } {
    const r = db
      .prepare("SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE product_id = ? AND status = 'published'")
      .get(productId) as { n: number; avg: number | null };
    return { count: Number(r.n), average: Number(r.n) === 0 ? null : r.avg };
  },
};
