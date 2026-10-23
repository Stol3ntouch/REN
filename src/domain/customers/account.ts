import { orders, reorder, type Order, type ReorderResult } from '@/domain/ordering';
import { getDb, type Db } from '@/server/db/connection';
import { consentsRepo, type ConsentRow } from '@/server/db/repositories/consents';
import { NotFoundError } from '@/server/http/errors';
import type { CookieReader, OwnerRef } from '@/server/http/owner';
import { getSession, type UserSession } from './session';

type Opts = { db?: Db; now?: number };

export type AccountGate = { ok: true; session: UserSession } | { ok: false; redirectTo: string };

/** Вход в кабинет: нет сессии покупателя → куда редиректить (на вход с возвратом на ту же страницу). */
export function accountGate(cookies: CookieReader, nextPath: string, opts: Opts = {}): AccountGate {
  const session = getSession(cookies, opts);
  if (session) return { ok: true, session };
  return { ok: false, redirectTo: `/account/login?next=${encodeURIComponent(nextPath)}` };
}

const asOwner = (userId: number): OwnerRef => ({ kind: 'user', userId });

/** Заказы кабинета. Чужой заказ (по номеру или id) → NotFoundError (404), как и несуществующий. */
export const accountOrders = {
  list(userId: number, opts: Opts = {}): Order[] {
    return orders.listForOwner(asOwner(userId), opts);
  },
  get(userId: number, ref: string, opts: Opts = {}): Order {
    const order = orders.getForCustomer(ref, asOwner(userId), opts);
    if (!order) throw new NotFoundError('Заказ не найден');
    return order;
  },
  /** «Повторить заказ»: доступное кладётся в корзину по текущим ценам, пропущенное возвращается с причиной. */
  reorder(userId: number, number: string, opts: Opts = {}): ReorderResult {
    return reorder(number, asOwner(userId), opts);
  },
};

export const accountConsents = {
  /** Записи согласий этого пользователя, новые первыми. */
  list(userId: number, opts: Opts = {}): ConsentRow[] {
    return consentsRepo.listAll(opts.db ?? getDb(), { userId }).sort((a, b) => b.grantedAt - a.grantedAt || b.id - a.id);
  },
};
