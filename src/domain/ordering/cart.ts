import { assertPricesShown } from '@/domain/content/store-flags';
import { applyPromo, normalizePromoCode, PROMO_MESSAGES, resolvePrice, type Promo, type PromoError, type PricedCart } from '@/domain/pricing';
import { formatRub } from '@/domain/pricing/format';
import { priceLinesWithPromotions } from '@/domain/pricing/promotion-rules';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { cartsRepo, type CartItemRow, type CartRow } from '@/server/db/repositories/carts';
import { promosRepo, type PromoRow } from '@/server/db/repositories/promos';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import type { OwnerRef } from '@/server/http/owner';
import { MAX_QTY, type CartLine, type CartView, type Change, type Opts } from './types';

/** Строка корзины с серверным пересчётом цены. */
export type PricedItem = {
  row: CartItemRow;
  unit: number;
  original: number | null;
  available: boolean;
  unavailableReason: 'out_of_stock' | 'unpublished' | null;
  /** Акция (C08), по которой посчитана цена; null — цена обычная или собственная скидочная. */
  promotionId: number | null;
  /** Цена ниже обычной (скидка товара или акция): купоны с excludeOnSale такие позиции пропускают. */
  onSale: boolean;
};

export type ComputedCart = {
  cart: CartRow | null;
  items: PricedItem[];
  priced: PricedCart;
  promo: PromoRow | null;
  promoError: PromoError | null;
  discount: number;
  view: CartView;
  /** Всё, что изменилось с момента, когда покупатель это видел. */
  changes: Change[];
};

function toPromo(p: PromoRow): Promo {
  return {
    code: p.code,
    type: p.type,
    value: p.value,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    usageLimit: p.usageLimit,
    usedCount: p.usedCount,
    minSubtotalKopecks: p.minSubtotalKopecks,
    enabled: p.enabled,
    excludeOnSale: p.excludeOnSale,
  };
}

export function promoErrorMessage(error: PromoError, promo: PromoRow | null): string {
  if (error === 'min_subtotal' && promo) {
    return `Минимальная сумма заказа для этого промокода — ${formatRub(promo.minSubtotalKopecks)}.`;
  }
  return PROMO_MESSAGES[error];
}

/** Единая точка пересчёта корзины: цены, наличие, сумма, скидка, список изменений. Читает БД, ничего не пишет. */
export function computeCart(db: Db, cart: CartRow | null, now: number): ComputedCart {
  const rows = cart ? cartsRepo.listItems(db, cart.id) : [];
  const base = rows.map((row) => {
    const price = resolvePrice({ priceKopecks: row.product.priceKopecks, discountPriceKopecks: row.product.discountPriceKopecks });
    const reason = !row.product.published ? 'unpublished' : !row.product.inStock ? 'out_of_stock' : null;
    return { row, price, reason } as const;
  });
  // Акции (C08): цена по акции считается на сервере по доступным позициям; без подходящей акции цена остаётся прежней.
  const promoPrices = priceLinesWithPromotions(
    db,
    base.filter((b) => b.reason === null).map((b) => ({ productId: b.row.productId, listKopecks: b.row.product.priceKopecks, ownKopecks: b.price.unit, qty: b.row.qty })),
    now,
  );
  const items: PricedItem[] = base.map(({ row, price, reason }) => {
    const promo = promoPrices.get(row.productId);
    const unit = promo ? promo.unit : price.unit;
    const original = promo ? promo.original : (price.original ?? null);
    return { row, unit, original, available: reason === null, unavailableReason: reason, promotionId: promo?.promotionId ?? null, onSale: unit < row.product.priceKopecks };
  });

  const available = items.filter((i) => i.available);
  const priced: PricedCart = {
    items: available.map((i) => ({ productId: i.row.productId, unit: i.unit, qty: i.row.qty, onSale: i.onSale })),
    subtotal: available.reduce((sum, i) => sum + i.unit * i.row.qty, 0),
  };

  let promoRow: PromoRow | null = null;
  let promoError: PromoError | null = null;
  let discount = 0;
  if (cart?.promoCode) {
    promoRow = promosRepo.findByCode(db, cart.promoCode);
    const res = applyPromo(priced, promoRow ? toPromo(promoRow) : null, new Date(now));
    if (!promoRow) promoError = 'not_found';
    else if (res.error) promoError = res.error;
    else discount = res.discount;
  }

  const changes: Change[] = [];
  for (const i of items) {
    if (i.unavailableReason) {
      changes.push({ kind: 'unavailable', productId: i.row.productId, name: i.row.product.name, reason: i.unavailableReason });
    } else if (i.unit !== i.row.seenUnitKopecks) {
      changes.push({
        kind: 'price_changed',
        productId: i.row.productId,
        name: i.row.product.name,
        oldUnitKopecks: i.row.seenUnitKopecks,
        newUnitKopecks: i.unit,
      });
    }
  }
  if (cart?.promoCode && promoError) {
    changes.push({ kind: 'promo_invalid', code: cart.promoCode, message: promoErrorMessage(promoError, promoRow) });
  }

  const lines: CartLine[] = items.map((i) => ({
    productId: i.row.productId,
    slug: i.row.product.slug,
    name: i.row.product.name,
    sku: i.row.product.sku,
    qty: i.row.qty,
    unitKopecks: i.unit,
    originalKopecks: i.original,
    lineKopecks: i.unit * i.row.qty,
    available: i.available,
    imageUrl: i.row.product.imageUrl,
  }));

  const view: CartView = {
    cartId: cart?.id ?? null,
    items: lines,
    count: items.reduce((n, i) => n + i.row.qty, 0),
    subtotalKopecks: priced.subtotal,
    discountKopecks: discount,
    totalKopecks: priced.subtotal - discount,
    promo: cart?.promoCode && promoRow && !promoError ? { code: promoRow.code, discountKopecks: discount } : null,
    promoError: cart?.promoCode && promoError ? promoErrorMessage(promoError, promoRow) : null,
  };

  return { cart, items, priced, promo: promoRow, promoError, discount, view, changes };
}

function assertQty(qty: unknown): number {
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    throw new ValidationError(`Количество должно быть целым числом от 1 до ${MAX_QTY}`, { qty: [`От 1 до ${MAX_QTY}`] });
  }
  return qty;
}

function assertProductId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) throw new ValidationError('Не указан товар', { productId: ['Не указан товар'] });
  return id;
}

function ensureCart(db: Db, owner: OwnerRef, now: number): CartRow {
  const existing = cartsRepo.findByOwner(db, owner);
  if (existing) return existing;
  const id = cartsRepo.create(db, owner, now);
  return cartsRepo.findById(db, id)!;
}

/**
 * После действия покупателя (добавил, изменил количество, убрал) цена позиции могла стать акционной из-за суммы корзины
 * (акция с минимальной суммой). Это его собственное действие, а не «изменение цены»: запоминаем новую цену как увиденную.
 * Изменения, которых покупатель не делал (акция закончилась, админ поменял цену), по-прежнему показываются.
 */
function syncPromoSeen(db: Db, cartId: number, now: number): void {
  const c = cartsRepo.findById(db, cartId);
  if (!c) return;
  for (const i of computeCart(db, c, now).items) {
    if (i.available && i.promotionId !== null && i.unit !== i.row.seenUnitKopecks) cartsRepo.setSeen(db, cartId, i.row.productId, i.unit, i.row.seenInStock);
  }
}

const view = (db: Db, owner: OwnerRef, now: number): CartView => computeCart(db, cartsRepo.findByOwner(db, owner), now).view;

export type ApplyPromoResult = { cart: CartView; error?: string; errorCode?: PromoError };

/**
 * Корзина. Владелец — OwnerRef (пользователь или гость по cookie rts_guest); цены и суммы всегда
 * считаются на сервере по products.price_kopecks / discount_price_kopecks.
 */
export const cart = {
  get(owner: OwnerRef | null, opts: Opts = {}): CartView {
    const db = opts.db ?? getDb();
    if (!owner) return computeCart(db, null, opts.now ?? Date.now()).view;
    return view(db, owner, opts.now ?? Date.now());
  },

  /** Что изменилось в корзине с момента, когда покупатель её видел (для предупреждения в корзине). */
  changes(owner: OwnerRef | null, opts: Opts = {}): Change[] {
    const db = opts.db ?? getDb();
    if (!owner) return [];
    return computeCart(db, cartsRepo.findByOwner(db, owner), opts.now ?? Date.now()).changes;
  },

  /** Добавляет qty к позиции (итог не выше 20). Нет в наличии / не опубликован — отказ на сервере. */
  add(owner: OwnerRef, input: { productId: number; qty: number }, opts: Opts = {}): CartView {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    assertPricesShown({ db, now });
    const productId = assertProductId(input.productId);
    const qty = assertQty(input.qty);
    let notice: string | undefined;
    withTransaction(db, () => {
      const product = cartsRepo.findProduct(db, productId);
      if (!product || !product.published) throw new NotFoundError('Товар не найден');
      if (!product.inStock) throw new ValidationError('Товара нет в наличии', { productId: ['Товара нет в наличии'] });
      const unit = resolvePrice({ priceKopecks: product.priceKopecks, discountPriceKopecks: product.discountPriceKopecks }).unit;
      const c = ensureCart(db, owner, now);
      const existing = cartsRepo.findItem(db, c.id, productId);
      if (existing) {
        const sum = existing.qty + qty;
        if (sum > MAX_QTY) notice = `Количество одной позиции ограничено ${MAX_QTY} шт.`;
        cartsRepo.setQty(db, c.id, productId, Math.min(sum, MAX_QTY));
        cartsRepo.setSeen(db, c.id, productId, unit, true);
      } else {
        cartsRepo.insertItem(db, { cartId: c.id, productId, qty, seenUnitKopecks: unit, seenInStock: true, now });
      }
      cartsRepo.touch(db, c.id, now);
      syncPromoSeen(db, c.id, now);
    });
    const result = view(db, owner, now);
    return notice ? { ...result, notice } : result;
  },

  /** Задаёт количество позиции (1–20). */
  setQty(owner: OwnerRef, productId: number, qty: number, opts: Opts = {}): CartView {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    assertProductId(productId);
    assertQty(qty);
    const c = cartsRepo.findByOwner(db, owner);
    if (!c || !cartsRepo.setQty(db, c.id, productId, qty)) throw new NotFoundError('Позиции нет в корзине');
    cartsRepo.touch(db, c.id, now);
    syncPromoSeen(db, c.id, now);
    return view(db, owner, now);
  },

  remove(owner: OwnerRef, productId: number, opts: Opts = {}): CartView {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const c = cartsRepo.findByOwner(db, owner);
    if (c) {
      cartsRepo.removeItem(db, c.id, assertProductId(productId));
      cartsRepo.touch(db, c.id, now);
      syncPromoSeen(db, c.id, now);
    }
    return view(db, owner, now);
  },

  /** Очистить корзину и снять промокод (после оформления заказа). */
  clear(owner: OwnerRef, opts: Opts = {}): void {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const c = cartsRepo.findByOwner(db, owner);
    if (!c) return;
    cartsRepo.clearItems(db, c.id);
    cartsRepo.setPromo(db, c.id, null, now);
  },

  /**
   * Слияние при входе/регистрации: гостевая корзина вливается в пользовательскую (количества
   * складываются, потолок 20), промокод гостя берётся, если у пользователя своего нет. Гостевая корзина удаляется.
   */
  merge(guestId: string | null, userId: number, opts: Opts = {}): void {
    if (!guestId) return;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const guestCart = cartsRepo.findByOwner(db, { kind: 'guest', guestId });
      if (!guestCart) return;
      const userCart = cartsRepo.findByOwner(db, { kind: 'user', userId });
      if (!userCart) {
        cartsRepo.reassignToUser(db, guestCart.id, userId, now);
        return;
      }
      for (const item of cartsRepo.listItems(db, guestCart.id)) {
        const existing = cartsRepo.findItem(db, userCart.id, item.productId);
        if (existing) cartsRepo.setQty(db, userCart.id, item.productId, Math.min(existing.qty + item.qty, MAX_QTY));
        else {
          cartsRepo.insertItem(db, {
            cartId: userCart.id,
            productId: item.productId,
            qty: item.qty,
            seenUnitKopecks: item.seenUnitKopecks,
            seenInStock: item.seenInStock,
            now,
          });
        }
      }
      if (!userCart.promoCode && guestCart.promoCode) cartsRepo.setPromo(db, userCart.id, guestCart.promoCode, now);
      else cartsRepo.touch(db, userCart.id, now);
      cartsRepo.delete(db, guestCart.id);
    });
  },

  /**
   * Применяет промокод (один на корзину, новый заменяет прежний). Ошибка — с понятным текстом;
   * корзина и прежний промокод остаются как были.
   */
  applyPromo(owner: OwnerRef, rawCode: string, opts: Opts = {}): ApplyPromoResult {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const code = normalizePromoCode(typeof rawCode === 'string' ? rawCode : '');
    if (code === '' || code.length > 64) throw new ValidationError('Введите промокод', { code: ['Введите промокод'] });
    const c = ensureCart(db, owner, now);
    const probe: CartRow = { ...c, promoCode: code };
    const computed = computeCart(db, probe, now);
    if (computed.promoError) {
      return {
        cart: computeCart(db, c, now).view,
        error: promoErrorMessage(computed.promoError, computed.promo),
        errorCode: computed.promoError,
      };
    }
    cartsRepo.setPromo(db, c.id, code, now);
    return { cart: view(db, owner, now) };
  },

  removePromo(owner: OwnerRef, opts: Opts = {}): CartView {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const c = cartsRepo.findByOwner(db, owner);
    if (c) cartsRepo.setPromo(db, c.id, null, now);
    return view(db, owner, now);
  },

  /**
   * Покупатель подтвердил список изменений: новые цены становятся «увиденными», недоступные позиции
   * убираются, недействующий промокод снимается. После этого validate/place снова проходят.
   */
  acknowledgeChanges(owner: OwnerRef, opts: Opts = {}): CartView {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const c = cartsRepo.findByOwner(db, owner);
      if (!c) return;
      const computed = computeCart(db, c, now);
      for (const i of computed.items) {
        if (!i.available) cartsRepo.removeItem(db, c.id, i.row.productId);
        else cartsRepo.setSeen(db, c.id, i.row.productId, i.unit, true);
      }
      if (c.promoCode && computed.promoError) cartsRepo.setPromo(db, c.id, null, now);
    });
    return view(db, owner, now);
  },
};
