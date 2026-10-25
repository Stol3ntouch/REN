import { withStaffPermission } from '@/domain/admin/guard';
import { orderOps, parseOrderFilters } from '@/domain/ordering/admin-ops';

export const dynamic = 'force-dynamic';

/** GET /admin/api/orders/export?<те же фильтры, что в списке> — CSV. Нужны orders.read и export.run (проверяет orderOps.exportCsv). */
export const GET = withStaffPermission('orders.read', (req, session) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const csv = orderOps.exportCsv(session, parseOrderFilters(sp));
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
