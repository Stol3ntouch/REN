import { visibleProductSql } from './products';
import type { Db } from '../connection';
import type { OwnerRef } from '@/server/http/owner';

export type CollectionTable = 'favorites' | 'compare_items';

/**
 * Список товаров владельца (избранное или сравнение): одна и та же форма таблиц.
 * Имя таблицы — только из типа CollectionTable (константа вызывающего), не из ввода.
 * В выдаче и счёте — только опубликованные товары.
 */
export function createCollectionRepo(table: CollectionTable) {
  const where = (owner: OwnerRef) => (owner.kind === 'user' ? { sql: 't.user_id = ?', arg: owner.userId } : { sql: 't.guest_id = ?', arg: owner.guestId });

  return {
    /** id товаров: 'asc' — в порядке добавления, 'desc' — сначала новые. */
    list(db: Db, owner: OwnerRef, order: 'asc' | 'desc' = 'desc'): number[] {
      const w = where(owner);
      const dir = order === 'asc' ? 'ASC' : 'DESC';
      const rows = db
        .prepare(`SELECT t.product_id AS id FROM ${table} t JOIN products p ON p.id = t.product_id WHERE ${w.sql} AND ${visibleProductSql('p')} ORDER BY t.id ${dir}`)
        .all(w.arg) as Array<{ id: number }>;
      return rows.map((r) => r.id);
    },
    count(db: Db, owner: OwnerRef): number {
      const w = where(owner);
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} t JOIN products p ON p.id = t.product_id WHERE ${w.sql} AND ${visibleProductSql('p')}`)
        .get(w.arg) as { n: number };
      return row.n;
    },
    has(db: Db, owner: OwnerRef, productId: number): boolean {
      const w = where(owner);
      return db.prepare(`SELECT 1 AS x FROM ${table} t WHERE ${w.sql} AND t.product_id = ?`).get(w.arg, productId) !== undefined;
    },
    /** true — добавлено, false — уже было (дубль не создаётся). */
    insert(db: Db, owner: OwnerRef, productId: number, now: number): boolean {
      const r =
        owner.kind === 'user'
          ? db.prepare(`INSERT OR IGNORE INTO ${table} (user_id, guest_id, product_id, created_at) VALUES (?, NULL, ?, ?)`).run(owner.userId, productId, now)
          : db.prepare(`INSERT OR IGNORE INTO ${table} (user_id, guest_id, product_id, created_at) VALUES (NULL, ?, ?, ?)`).run(owner.guestId, productId, now);
      return Number(r.changes) > 0;
    },
    remove(db: Db, owner: OwnerRef, productId: number): boolean {
      const col = owner.kind === 'user' ? 'user_id' : 'guest_id';
      const arg = owner.kind === 'user' ? owner.userId : owner.guestId;
      return Number(db.prepare(`DELETE FROM ${table} WHERE ${col} = ? AND product_id = ?`).run(arg, productId).changes) > 0;
    },
    /** Все записи гостя в порядке добавления (в т.ч. неопубликованные — они просто не покажутся). */
    guestProductIds(db: Db, guestId: string): number[] {
      return (db.prepare(`SELECT product_id AS id FROM ${table} WHERE guest_id = ? ORDER BY id`).all(guestId) as Array<{ id: number }>).map((r) => r.id);
    },
    deleteGuest(db: Db, guestId: string): void {
      db.prepare(`DELETE FROM ${table} WHERE guest_id = ?`).run(guestId);
    },
  };
}

export const favoritesRepo = createCollectionRepo('favorites');
