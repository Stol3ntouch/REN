import { withStaffPermission } from '@/domain/admin/guard';
import { parseProductListQuery } from '@/domain/catalog/products-list';
import { productListOps } from '@/app/admin/(panel)/_lib/product-list-ops';

export const dynamic = 'force-dynamic';

/**
 * GET /admin/api/products?q&category&brand&availability&published&hidden&priceMin&priceMax&new&featured&promo&sort&dir&page&pageSize
 * Ответ { items, total, page, pageSize }. Нужно products.read (проверяет и productListOps.list). Закупочной цены в ответе нет.
 */
export const GET = withStaffPermission('products.read', (req, session) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  return Response.json(productListOps.list(session, parseProductListQuery(sp)), { headers: { 'cache-control': 'no-store' } });
});
