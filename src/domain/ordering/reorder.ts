import { getDb } from '@/server/db/connection';
import { AppError, NotFoundError } from '@/server/http/errors';
import type { OwnerRef } from '@/server/http/owner';
import { cart } from './cart';
import { orders } from './orders';
import { MAX_QTY, type CartView, type Opts } from './types';

export type ReorderResult = { cart: CartView; added: number; skipped: Array<{ name: string; reason: string }> };

/**
 * «Повторить заказ» (T07 вызывает из кабинета): кладёт в корзину владельца позиции прошлого заказа
 * в тех же количествах по ТЕКУЩИМ ценам. Недоступные пропускаются с причиной. Чужой заказ → NotFoundError (404).
 */
export function reorder(orderNumber: string, owner: OwnerRef, opts: Opts = {}): ReorderResult {
  const db = opts.db ?? getDb();
  const order = orders.getForCustomer(orderNumber, owner, { db });
  if (!order) throw new NotFoundError('Заказ не найден');
  const skipped: ReorderResult['skipped'] = [];
  let added = 0;
  for (const item of order.items) {
    if (item.productId === null) {
      skipped.push({ name: item.name, reason: 'Товар больше не продаётся' });
      continue;
    }
    try {
      cart.add(owner, { productId: item.productId, qty: Math.min(Math.max(item.qty, 1), MAX_QTY) }, opts);
      added += 1;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      skipped.push({ name: item.name, reason: e.status === 404 ? 'Товар больше не продаётся' : 'Сейчас нет в наличии' });
    }
  }
  return { cart: cart.get(owner, opts), added, skipped };
}
