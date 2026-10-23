'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cart, checkout, CheckoutChangesError } from '@/domain/ordering';
import { cartErrorState, formInt, formStr, isHoneypotTripped, prepareCartAction } from '@/ui/cart/server-context';
import type { CartFormState } from '@/ui/cart/state';
import { resolveOrderTarget } from './payment-target';

/**
 * Оформление заказа. Владелец — из cookies; корзина — его собственная; цены, наличие, суммы, способы
 * проверяет и считает сервер (checkout.place). Повторная отправка с тем же ключом даёт тот же заказ.
 */
export async function placeOrderAction(_prev: CartFormState, form: FormData): Promise<CartFormState> {
  let target: string;
  try {
    const { owner } = await prepareCartAction('checkout', 20);
    if (isHoneypotTripped(form)) return { status: 'error', message: 'Не удалось оформить заказ. Попробуйте ещё раз.' };
    const order = await checkout.place({
      owner,
      cartId: cart.get(owner).cartId,
      contact: {
        name: formStr(form, 'name'),
        email: formStr(form, 'email'),
        phone: formStr(form, 'phone'),
        address: formStr(form, 'address'),
        comment: formStr(form, 'comment'),
      },
      deliveryMethodId: formInt(form, 'deliveryMethodId'),
      paymentMethodId: formInt(form, 'paymentMethodId'),
      idempotencyKey: formStr(form, 'idempotencyKey'),
      consent: form.get('consent') === 'on',
    });
    revalidatePath('/cart');

    // Заказ создан. Старт онлайн-оплаты (T06) отделён: его сбой не отменяет редирект на страницу заказа.
    target = await resolveOrderTarget(order);
  } catch (e) {
    if (e instanceof CheckoutChangesError) return { status: 'error', message: e.message, changes: e.changes };
    return cartErrorState(e);
  }
  redirect(target);
}
