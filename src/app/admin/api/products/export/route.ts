import { withStaffPermission } from '@/domain/admin/guard';
import { parseProductFilter } from '@/domain/catalog/products-list';
import { productListOps } from '@/app/admin/(panel)/_lib/product-list-ops';

export const dynamic = 'force-dynamic';

/**
 * GET /admin/api/products/export?<те же фильтры, что в списке> — CSV (UTF-8 с BOM, «;»), строки отдаются порциями.
 * Нужны products.read и export.run (проверяет productListOps.exportCsv); закупочная цена — только с products.cost.
 */
export const GET = withStaffPermission('products.read', (req, session) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { chunks } = productListOps.exportCsv(session, parseProductFilter(sp));
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    cancel() {
      chunks.return();
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
