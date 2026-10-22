import { cart } from '@/domain/ordering';
import { NotFoundError } from '@/server/http/errors';
import { handleCart, promoCodeSchema } from '../handler';

/** POST /api/cart/promo {code} — применить промокод. Ошибка не ломает корзину: ответ — корзина + поле error с текстом. */
export async function POST(req: Request): Promise<Response> {
  return handleCart(req, { schema: promoCodeSchema, create: true }, (owner, body) => {
    const res = cart.applyPromo(owner!, body.code);
    return { ...res.cart, ...(res.error ? { error: res.error } : {}) };
  });
}

/** DELETE /api/cart/promo — снять промокод. */
export async function DELETE(req: Request): Promise<Response> {
  return handleCart(req, { create: false }, (owner) => {
    if (!owner) throw new NotFoundError('Корзина не найдена');
    return cart.removePromo(owner);
  });
}
