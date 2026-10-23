import { favorites } from '@/domain/customers/favorites';
import { handleOwnerRequest } from './handler';

/** GET /api/favorites → {ids, count}: что в избранном у текущего посетителя (гостя не создаёт). */
export async function GET(req: Request): Promise<Response> {
  return handleOwnerRequest(req, { write: false, scope: 'fav' }, (owner) => {
    const ids = favorites.list(owner);
    return { ids, count: ids.length };
  });
}

/** POST {productId} — добавить (идемпотентно). Нет товара → 404. */
export async function POST(req: Request): Promise<Response> {
  return handleOwnerRequest(req, { write: true, scope: 'fav' }, (owner, body) => {
    favorites.add(owner!, body!.productId);
    const ids = favorites.list(owner);
    return { on: true, ids, count: ids.length };
  });
}

/** DELETE {productId} — убрать. */
export async function DELETE(req: Request): Promise<Response> {
  return handleOwnerRequest(req, { write: true, scope: 'fav' }, (owner, body) => {
    favorites.remove(owner!, body!.productId);
    const ids = favorites.list(owner);
    return { on: false, ids, count: ids.length };
  });
}
