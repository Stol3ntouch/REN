import { withStaffPermission } from '@/domain/admin/guard';
import { auditFilterFromParams } from '../../_lib/audit-params';
import { auditOps } from '../../_lib/audit-ops';

/** Экспорт отфильтрованного журнала в CSV; право audit.read (проверяется и обёрткой, и внутри auditOps). */
export const GET = withStaffPermission('audit.read', (req, session) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { csv } = auditOps.exportCsv(session, auditFilterFromParams(sp));
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="audit-log.csv"',
      'cache-control': 'no-store',
    },
  });
});
