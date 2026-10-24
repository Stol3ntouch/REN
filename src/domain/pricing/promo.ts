export type PromoError = 'not_found' | 'disabled' | 'not_started' | 'expired' | 'limit_reached' | 'min_subtotal' | 'only_on_sale';

export type Promo = {
  code: string;
  type: 'percent' | 'fixed';
  /** percent: 1..100; fixed: копейки. */
  value: number;
  startsAt: number | null;
  endsAt: number | null;
  usageLimit: number | null;
  usedCount: number;
  minSubtotalKopecks: number;
  enabled: boolean;
  /** Купон не действует на позиции по акционной или скидочной цене (выбор администратора). */
  excludeOnSale?: boolean;
};

/** onSale — цена позиции ниже обычной (скидка товара или акция); нужна купонам с excludeOnSale. */
export type PricedLine = { productId: number; unit: number; qty: number; onSale?: boolean };
export type PricedCart = { items: PricedLine[]; subtotal: number };
export type PromoResult = { discount: number; error?: PromoError };

export const PROMO_MESSAGES: Record<PromoError, string> = {
  not_found: 'Такого промокода нет. Проверьте написание.',
  disabled: 'Этот промокод сейчас не действует.',
  not_started: 'Срок действия этого промокода ещё не начался.',
  expired: 'Срок действия промокода истёк.',
  limit_reached: 'Промокод уже использован максимальное число раз.',
  min_subtotal: 'Сумма заказа меньше минимальной для этого промокода.',
  only_on_sale: 'Промокод не действует на товары по акции и со скидкой.',
};

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Скидка по промокоду на сумму товаров (доставка не участвует). Чистая функция.
 * Нет промокода → скидки нет и ошибки нет. Ошибка → discount 0 (корзина не меняется).
 * Процент округляется вниз до копейки; скидка не превышает сумму, к которой применяется.
 * Один купон на заказ: корзина и заказ хранят один код. Купон с excludeOnSale считается только от позиций без акционной и
 * скидочной цены (onSale); если таких позиций нет — ошибка only_on_sale.
 */
export function applyPromo(cart: PricedCart, promo: Promo | null, now: Date): PromoResult {
  if (!promo) return { discount: 0 };
  const t = now.getTime();
  if (!promo.enabled) return { discount: 0, error: 'disabled' };
  if (promo.startsAt !== null && t < promo.startsAt) return { discount: 0, error: 'not_started' };
  if (promo.endsAt !== null && t > promo.endsAt) return { discount: 0, error: 'expired' };
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) return { discount: 0, error: 'limit_reached' };
  if (cart.subtotal < promo.minSubtotalKopecks) return { discount: 0, error: 'min_subtotal' };
  const base = promo.excludeOnSale ? cart.items.filter((i) => !i.onSale).reduce((sum, i) => sum + i.unit * i.qty, 0) : cart.subtotal;
  if (promo.excludeOnSale && base === 0 && cart.subtotal > 0) return { discount: 0, error: 'only_on_sale' };
  const raw = promo.type === 'percent' ? Math.floor((base * promo.value) / 100) : promo.value;
  return { discount: Math.max(0, Math.min(raw, base)) };
}
