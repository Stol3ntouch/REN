import { visibleProductSql } from '@/server/db/repositories/products';
import type { ProductCard } from '@/domain/catalog/types';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { favoritesRepo } from '@/server/db/repositories/favorites';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import type { OwnerRef } from '@/server/http/owner';
import { cardsByIds } from './cards';

export const MAX_FAVORITES = 200;

export type CollectionOpts = { db?: Db; now?: number };

/** Товар должен существовать и быть опубликованным — иначе 404 (не раскрываем скрытое). */
export function assertPublishedProduct(db: Db, productId: number): void {
  const row = db.prepare(`SELECT 1 AS x FROM products p WHERE p.id = ? AND ${visibleProductSql('p')}`).get(productId);
  if (!row) throw new NotFoundError('Товар не найден');
}

/** Избранное гостя (по guestId) и пользователя (по userId). Владельца определяет вызывающий (resolveOwner). */
export const favorites = {
  /** Идемпотентно: повторное добавление дубля не создаёт. */
  add(owner: OwnerRef, productId: number, opts: CollectionOpts = {}): { added: boolean; count: number } {
    const db = opts.db ?? getDb();
    return withTransaction(db, () => {
      assertPublishedProduct(db, productId);
      if (!favoritesRepo.has(db, owner, productId) && favoritesRepo.count(db, owner) >= MAX_FAVORITES) {
        throw new ValidationError(`В избранном может быть не больше ${MAX_FAVORITES} товаров`);
      }
      const added = favoritesRepo.insert(db, owner, productId, opts.now ?? Date.now());
      return { added, count: favoritesRepo.count(db, owner) };
    });
  },

  /** Снять отметку; если её не было — тихо ничего. */
  remove(owner: OwnerRef, productId: number, opts: CollectionOpts = {}): { count: number } {
    const db = opts.db ?? getDb();
    favoritesRepo.remove(db, owner, productId);
    return { count: favoritesRepo.count(db, owner) };
  },

  toggle(owner: OwnerRef, productId: number, opts: CollectionOpts = {}): { on: boolean; count: number } {
    const db = opts.db ?? getDb();
    if (favoritesRepo.has(db, owner, productId)) return { on: false, count: favorites.remove(owner, productId, opts).count };
    return { on: true, count: favorites.add(owner, productId, opts).count };
  },

  /** id товаров, сначала добавленные последними. Нет владельца (гость без cookie) — пусто. */
  list(owner: OwnerRef | null, opts: CollectionOpts = {}): number[] {
    return owner ? favoritesRepo.list(opts.db ?? getDb(), owner, 'desc') : [];
  },

  cards(owner: OwnerRef | null, opts: CollectionOpts = {}): ProductCard[] {
    const db = opts.db ?? getDb();
    return cardsByIds(db, favorites.list(owner, { db }));
  },

  has(owner: OwnerRef | null, productId: number, opts: CollectionOpts = {}): boolean {
    return owner ? favoritesRepo.has(opts.db ?? getDb(), owner, productId) : false;
  },

  count(owner: OwnerRef | null, opts: CollectionOpts = {}): number {
    return owner ? favoritesRepo.count(opts.db ?? getDb(), owner) : 0;
  },

  /** Вход/регистрация: избранное гостя вливается в аккаунт без дублей, у гостя ничего не остаётся. */
  merge(guestId: string | null, userId: number, opts: CollectionOpts = {}): void {
    if (!guestId) return;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const user: OwnerRef = { kind: 'user', userId };
      for (const productId of favoritesRepo.guestProductIds(db, guestId)) {
        if (favoritesRepo.count(db, user) >= MAX_FAVORITES) break;
        favoritesRepo.insert(db, user, productId, now);
      }
      favoritesRepo.deleteGuest(db, guestId);
    });
  },
};

/** Счётчик для шапки. */
export function favoritesCount(owner: OwnerRef | null, opts: CollectionOpts = {}): number {
  return favorites.count(owner, opts);
}
