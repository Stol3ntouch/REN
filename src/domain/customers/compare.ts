import type { ProductCard } from '@/domain/catalog/types';
import { getDb, withTransaction } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { compareRepo } from '@/server/db/repositories/compare';
import { ConflictError } from '@/server/http/errors';
import type { OwnerRef } from '@/server/http/owner';
import { cardsByIds } from './cards';
import { assertPublishedProduct, type CollectionOpts } from './favorites';

export const MAX_COMPARE = 4;

export type CompareRow = {
  /** Название характеристики. */
  name: string;
  /** Значение у каждого товара в порядке products; нет характеристики — null. */
  values: Array<string | null>;
  /** Значения различаются (отсутствие у одного из товаров тоже различие). */
  differs: boolean;
};
export type CompareTable = { products: ProductCard[]; rows: CompareRow[] };

const normalize = (v: string | null): string => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const compare = {
  /** До 4 товаров. Повторное добавление того же — не ошибка; 5-й → ConflictError с понятным текстом. */
  add(owner: OwnerRef, productId: number, opts: CollectionOpts = {}): { added: boolean; count: number } {
    const db = opts.db ?? getDb();
    return withTransaction(db, () => {
      assertPublishedProduct(db, productId);
      if (compareRepo.has(db, owner, productId)) return { added: false, count: compareRepo.count(db, owner) };
      if (compareRepo.count(db, owner) >= MAX_COMPARE) {
        throw new ConflictError(`В сравнении уже ${MAX_COMPARE} товара — это максимум. Уберите один, чтобы добавить другой.`);
      }
      compareRepo.insert(db, owner, productId, opts.now ?? Date.now());
      return { added: true, count: compareRepo.count(db, owner) };
    });
  },

  remove(owner: OwnerRef, productId: number, opts: CollectionOpts = {}): { count: number } {
    const db = opts.db ?? getDb();
    compareRepo.remove(db, owner, productId);
    return { count: compareRepo.count(db, owner) };
  },

  /** id товаров в порядке добавления. */
  list(owner: OwnerRef | null, opts: CollectionOpts = {}): number[] {
    return owner ? compareRepo.list(opts.db ?? getDb(), owner, 'asc') : [];
  },

  count(owner: OwnerRef | null, opts: CollectionOpts = {}): number {
    return owner ? compareRepo.count(opts.db ?? getDb(), owner) : 0;
  },

  /** Вход/регистрация: товары гостя добавляются к аккаунту без дублей и сверх лимита 4 не идут; у гостя ничего не остаётся. */
  merge(guestId: string | null, userId: number, opts: CollectionOpts = {}): void {
    if (!guestId) return;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const user: OwnerRef = { kind: 'user', userId };
      for (const productId of compareRepo.guestProductIds(db, guestId)) {
        if (compareRepo.count(db, user) >= MAX_COMPARE) break;
        compareRepo.insert(db, user, productId, now);
      }
      compareRepo.deleteGuest(db, guestId);
    });
  },

  /** Таблица характеристик: объединение имён по порядку первого появления, различия помечены. */
  table(owner: OwnerRef | null, opts: CollectionOpts = {}): CompareTable {
    const db = opts.db ?? getDb();
    const products = cardsByIds(db, compare.list(owner, { db }));
    const attrs = products.map((p) => {
      const m = new Map<string, string>();
      // повтор одного имени у товара — берём первое значение
      for (const a of attributesRepo.listByProduct(db, p.id)) if (!m.has(a.name)) m.set(a.name, a.value);
      return m;
    });
    const names: string[] = [];
    for (const m of attrs) for (const name of m.keys()) if (!names.includes(name)) names.push(name);
    const rows = names.map((name): CompareRow => {
      const values = attrs.map((m) => m.get(name) ?? null);
      return { name, values, differs: new Set(values.map(normalize)).size > 1 };
    });
    return { products, rows };
  },
};

/** Счётчик для шапки. */
export function compareCount(owner: OwnerRef | null, opts: CollectionOpts = {}): number {
  return compare.count(owner, opts);
}
