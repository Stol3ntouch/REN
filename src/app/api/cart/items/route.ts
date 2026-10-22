import { cart } from '@/domain/ordering';
import { NotFoundError } from '@/server/http/errors';
import { handleCart, productIdSchema, productQtySchema } from '../handler';

/**
 * POST /api/cart/items {productId, qty} — добавить qty к позиции (итог ≤ 20). Ответ — актуальная корзина
 * {items, count, totalKopecks, …}; при обрезке до 20 есть поле notice. Нет в наличии → 400, нет товара → 404.
 */
export async function POST(req: Request): Promise<Response> {
  return handleCart(req, { schema: productQtySchema, create: true }, (owner, body) => cart.add(owner!, body));
}

/** PATCH /api/cart/items {productId, qty} — задать количество (1–20). */
export async function PATCH(req: Request): Promise<Response> {
  return handleCart(req, { schema: productQtySchema, create: true }, (owner, body) => cart.setQty(owner!, body.productId, body.qty));
}

/** DELETE /api/cart/items {productId} — убрать позицию. */
export async function DELETE(req: Request): Promise<Response> {
  return handleCart(req, { schema: productIdSchema, create: false }, (owner, body) => {
    if (!owner) throw new NotFoundError('Позиции нет в корзине');
    return cart.remove(owner, body.productId);
  });
}
