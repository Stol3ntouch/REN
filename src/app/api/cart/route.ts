import { cart } from '@/domain/ordering';
import { handleCart } from './handler';

/** Актуальная корзина текущего посетителя: {items, count, totalKopecks, …}. Гостя не создаёт. */
export async function GET(req: Request): Promise<Response> {
  return handleCart(req, {}, (owner) => cart.get(owner));
}
