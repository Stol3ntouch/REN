import { compare, MAX_COMPARE } from '@/domain/customers/compare';
import { handleOwnerRequest } from '../favorites/handler';

/** GET /api/compare → {ids, count, max}. */
export async function GET(req: Request): Promise<Response> {
  return handleOwnerRequest(req, { write: false, scope: 'cmp' }, (owner) => {
    const ids = compare.list(owner);
    return { ids, count: ids.length, max: MAX_COMPARE };
  });
}

/** POST {productId} — добавить. 5-й товар → 409 с понятным сообщением. */
export async function POST(req: Request): Promise<Response> {
  return handleOwnerRequest(req, { write: true, scope: 'cmp' }, (owner, body) => {
    compare.add(owner!, body!.productId);
    const ids = compare.list(owner);
    return { on: true, ids, count: ids.length, max: MAX_COMPARE };
  });
}

/** DELETE {productId} — убрать. */
export async function DELETE(req: Request): Promise<Response> {
  return handleOwnerRequest(req, { write: true, scope: 'cmp' }, (owner, body) => {
    compare.remove(owner!, body!.productId);
    const ids = compare.list(owner);
    return { on: false, ids, count: ids.length, max: MAX_COMPARE };
  });
}
