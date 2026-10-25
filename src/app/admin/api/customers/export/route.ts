import { customersOps, parseCustomerFilters } from '@/app/admin/(panel)/_lib/customers-ops';
import { withStaffPermission } from '@/domain/admin/guard';

export const dynamic = 'force-dynamic';

/** GET /admin/api/customers/export?<фильтры списка> — CSV клиентов. Нужны customers.read и export.run (проверяет customersOps.exportCsv). */
export const GET = withStaffPermission('customers.read', (req, session) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const csv = customersOps.exportCsv(session, parseCustomerFilters(sp));
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
