import { cart } from './cart';
import type { Opts } from './types';

/** Хук входа/регистрации: гостевая корзина вливается в корзину пользователя (R13.1). */
export function mergeGuestCartOnLogin(guestId: string | null, userId: number, opts: Opts = {}): void {
  cart.merge(guestId, userId, opts);
}
