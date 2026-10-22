'use server';

import { revalidatePath } from 'next/cache';
import { cart } from '@/domain/ordering';
import { AppError } from '@/server/http/errors';
import type { CartFormState } from '@/ui/cart/state';
import { cartErrorState, formInt, formStr, prepareCartAction } from '@/ui/cart/server-context';

/** Кнопки «−» / «+»: новое количество приходит в форме, сервер проверяет границы 1–20. */
export async function changeQtyAction(form: FormData): Promise<void> {
  try {
    const { owner } = await prepareCartAction('cart');
    const qty = formInt(form, 'qty');
    if (qty === 0) cart.remove(owner, formInt(form, 'productId'));
    else cart.setQty(owner, formInt(form, 'productId'), qty);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
  }
  revalidatePath('/cart');
}

export async function removeItemAction(form: FormData): Promise<void> {
  try {
    const { owner } = await prepareCartAction('cart');
    cart.remove(owner, formInt(form, 'productId'));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
  }
  revalidatePath('/cart');
}

export async function applyPromoAction(_prev: CartFormState, form: FormData): Promise<CartFormState> {
  try {
    const { owner } = await prepareCartAction('promo', 30);
    const res = cart.applyPromo(owner, formStr(form, 'code'));
    revalidatePath('/cart');
    if (res.error) return { status: 'error', message: res.error };
    return { status: 'success', message: 'Промокод применён.' };
  } catch (e) {
    return cartErrorState(e);
  }
}

export async function removePromoAction(): Promise<void> {
  try {
    const { owner } = await prepareCartAction('promo', 30);
    cart.removePromo(owner);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
  }
  revalidatePath('/cart');
}

/** «Принять изменения»: новые цены, недоступные позиции убираются, недействующий промокод снимается. */
export async function acknowledgeChangesAction(): Promise<void> {
  try {
    const { owner } = await prepareCartAction('cart');
    cart.acknowledgeChanges(owner);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
  }
  revalidatePath('/cart');
  revalidatePath('/checkout');
}
