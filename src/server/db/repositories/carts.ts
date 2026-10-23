import type { OwnerRef } from '../../http/owner';
import type { Db } from '../connection';
import { visibleProductSql } from './products';

export type CartRow = { id: number; userId: number | null; guestId: string | null; promoCode: string | null; createdAt: number; updatedAt: number };

/** Строка корзины вместе с текущими данными товара. */
export type CartItemRow = {
  id: number;
  cartId: number;
  productId: number;
  qty: number;
  seenUnitKopecks: number;
  seenInStock: boolean;
  product: {
    slug: string;
    name: string;
    sku: string | null;
    priceKopecks: number;
    discountPriceKopecks: number | null;
    inStock: boolean;
    published: boolean;
    imageUrl: string | null;
  };
};

type RawCart = { id: number; user_id: number | null; guest_id: string | null; promo_code: string | null; created_at: number; updated_at: number };
type RawItem = {
  id: number;
  cart_id: number;
  product_id: number;
  qty: number;
  seen_unit_kopecks: number;
  seen_in_stock: number;
  slug: string;
  name: string;
  sku: string | null;
  price_kopecks: number;
  discount_price_kopecks: number | null;
  in_stock: number;
  published: number;
  image_url: string | null;
};

const mapCart = (r: RawCart | undefined): CartRow | null =>
  r ? { id: r.id, userId: r.user_id, guestId: r.guest_id, promoCode: r.promo_code, createdAt: r.created_at, updatedAt: r.updated_at } : null;

/** published в строке корзины = товар виден на сайте (опубликован и не скрыт админом): скрытый помечается недоступным. */
const ITEMS_SQL = `SELECT ci.id, ci.cart_id, ci.product_id, ci.qty, ci.seen_unit_kopecks, ci.seen_in_stock,
  p.slug, p.name, p.sku, p.price_kopecks, p.discount_price_kopecks, p.in_stock, ${visibleProductSql('p')} AS published,
  (SELECT url_source FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort, pi.id LIMIT 1) AS image_url
  FROM cart_items ci JOIN products p ON p.id = ci.product_id`;

const mapItem = (r: RawItem): CartItemRow => ({
  id: r.id,
  cartId: r.cart_id,
  productId: r.product_id,
  qty: r.qty,
  seenUnitKopecks: r.seen_unit_kopecks,
  seenInStock: r.seen_in_stock === 1,
  product: {
    slug: r.slug,
    name: r.name,
    sku: r.sku,
    priceKopecks: r.price_kopecks,
    discountPriceKopecks: r.discount_price_kopecks,
    inStock: r.in_stock === 1,
    published: r.published === 1,
    imageUrl: r.image_url,
  },
});

export const cartsRepo = {
  findByOwner(db: Db, owner: OwnerRef): CartRow | null {
    const raw =
      owner.kind === 'user'
        ? db.prepare('SELECT * FROM carts WHERE user_id = ?').get(owner.userId)
        : db.prepare('SELECT * FROM carts WHERE guest_id = ?').get(owner.guestId);
    return mapCart(raw as RawCart | undefined);
  },
  findById(db: Db, id: number): CartRow | null {
    return mapCart(db.prepare('SELECT * FROM carts WHERE id = ?').get(id) as RawCart | undefined);
  },
  create(db: Db, owner: OwnerRef, now: number): number {
    const r =
      owner.kind === 'user'
        ? db.prepare('INSERT INTO carts (user_id, guest_id, created_at, updated_at) VALUES (?, NULL, ?, ?)').run(owner.userId, now, now)
        : db.prepare('INSERT INTO carts (user_id, guest_id, created_at, updated_at) VALUES (NULL, ?, ?, ?)').run(owner.guestId, now, now);
    return Number(r.lastInsertRowid);
  },
  touch(db: Db, id: number, now: number): void {
    db.prepare('UPDATE carts SET updated_at = ? WHERE id = ?').run(now, id);
  },
  setPromo(db: Db, id: number, code: string | null, now: number): void {
    db.prepare('UPDATE carts SET promo_code = ?, updated_at = ? WHERE id = ?').run(code, now, id);
  },
  /** Гостевая корзина целиком переходит пользователю (у него своей ещё нет). */
  reassignToUser(db: Db, id: number, userId: number, now: number): void {
    db.prepare('UPDATE carts SET user_id = ?, guest_id = NULL, updated_at = ? WHERE id = ?').run(userId, now, id);
  },
  delete(db: Db, id: number): void {
    db.prepare('DELETE FROM carts WHERE id = ?').run(id);
  },
  listItems(db: Db, cartId: number): CartItemRow[] {
    return (db.prepare(`${ITEMS_SQL} WHERE ci.cart_id = ? ORDER BY ci.id`).all(cartId) as RawItem[]).map(mapItem);
  },
  findItem(db: Db, cartId: number, productId: number): { id: number; qty: number } | null {
    const r = db.prepare('SELECT id, qty FROM cart_items WHERE cart_id = ? AND product_id = ?').get(cartId, productId) as
      | { id: number; qty: number }
      | undefined;
    return r ?? null;
  },
  insertItem(db: Db, v: { cartId: number; productId: number; qty: number; seenUnitKopecks: number; seenInStock: boolean; now: number }): void {
    db.prepare(
      'INSERT INTO cart_items (cart_id, product_id, qty, seen_unit_kopecks, seen_in_stock, added_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(v.cartId, v.productId, v.qty, v.seenUnitKopecks, v.seenInStock ? 1 : 0, v.now);
  },
  setQty(db: Db, cartId: number, productId: number, qty: number): boolean {
    return Number(db.prepare('UPDATE cart_items SET qty = ? WHERE cart_id = ? AND product_id = ?').run(qty, cartId, productId).changes) > 0;
  },
  setSeen(db: Db, cartId: number, productId: number, seenUnitKopecks: number, seenInStock: boolean): void {
    db.prepare('UPDATE cart_items SET seen_unit_kopecks = ?, seen_in_stock = ? WHERE cart_id = ? AND product_id = ?').run(
      seenUnitKopecks,
      seenInStock ? 1 : 0,
      cartId,
      productId,
    );
  },
  removeItem(db: Db, cartId: number, productId: number): boolean {
    return Number(db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(cartId, productId).changes) > 0;
  },
  clearItems(db: Db, cartId: number): void {
    db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cartId);
  },
  /** Данные товара для добавления в корзину. */
  findProduct(
    db: Db,
    productId: number,
  ): { id: number; priceKopecks: number; discountPriceKopecks: number | null; inStock: boolean; published: boolean } | null {
    const r = db
      .prepare(`SELECT p.id, p.price_kopecks, p.discount_price_kopecks, p.in_stock, ${visibleProductSql('p')} AS published FROM products p WHERE p.id = ?`)
      .get(productId) as
      | { id: number; price_kopecks: number; discount_price_kopecks: number | null; in_stock: number; published: number }
      | undefined;
    return r
      ? {
          id: r.id,
          priceKopecks: r.price_kopecks,
          discountPriceKopecks: r.discount_price_kopecks,
          inStock: r.in_stock === 1,
          published: r.published === 1,
        }
      : null;
  },
};
