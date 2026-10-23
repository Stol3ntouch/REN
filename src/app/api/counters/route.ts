import { cart } from '@/domain/ordering';
import { compare } from '@/domain/customers/compare';
import { favorites } from '@/domain/customers/favorites';
import { handleOwnerRequest } from '../favorites/handler';

/**
 * GET /api/counters → {cart, favorites, compare} — числа для шапки (T08).
 * С ?ids=1 дополнительно {favoriteIds, compareIds} — по ним кнопки на карточках узнают своё состояние.
 * Гостя не создаёт: нет cookie — нули.
 */
export async function GET(req: Request): Promise<Response> {
  const withIds = new URL(req.url).searchParams.get('ids') === '1';
  return handleOwnerRequest(req, { write: false, scope: 'cnt' }, (owner) => {
    const favoriteIds = favorites.list(owner);
    const compareIds = compare.list(owner);
    const base = { cart: cart.get(owner).count, favorites: favoriteIds.length, compare: compareIds.length };
    return withIds ? { ...base, favoriteIds, compareIds } : base;
  });
}
