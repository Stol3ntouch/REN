import { withStaffPermission } from '@/domain/admin/guard';
import { getDb } from '@/server/db/connection';
import { promotionsRepo } from '@/server/db/repositories/promotions';

export const dynamic = 'force-dynamic';

/**
 * GET /admin/api/content/products?q= — поиск товаров для выбора в акции (до 20 штук).
 * Право content.write (Origin и сессия — withStaffPermission). Отдаёт только id, название и артикул.
 */
export const GET = withStaffPermission('content.write', async (req) => {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 100);
  const items = q.length < 2 ? [] : promotionsRepo.searchProducts(getDb(), q, 20).map((p) => ({ id: p.id, name: p.name, sku: p.sku }));
  return Response.json({ items }, { headers: { 'cache-control': 'no-store' } });
});
