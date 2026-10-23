import { withStaffPermission } from '@/domain/admin/guard';
import { analyticsOps, CSV_KINDS, parseBucket, parseRange, type CsvKind } from '@/domain/analytics';
import type { Db } from '@/server/db/connection';
import { ValidationError } from '@/server/http/errors';

/** GET /admin/analytics/export?kind=series|categories|products|cancellations&from=&to=&by=day|week|month — CSV (UTF-8 с BOM). Право analytics.read. */
export function createAnalyticsExportHandler(opts: { db?: Db; now?: number } = {}) {
  const auth = opts.db ? { db: opts.db, ...(opts.now !== undefined ? { now: opts.now } : {}) } : {};
  return withStaffPermission(
    'analytics.read',
    (req, session) => {
      const url = new URL(req.url);
      const kind = url.searchParams.get('kind') ?? '';
      if (!(CSV_KINDS as readonly string[]).includes(kind)) throw new ValidationError('Неизвестный вид выгрузки');
      const range = parseRange(Object.fromEntries(url.searchParams), opts.now ?? Date.now());
      const csv = analyticsOps.exportCsv(session, kind as CsvKind, range, parseBucket(url.searchParams.get('by')), { db: opts.db });
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="analytics-${kind}-${range.fromStr}_${range.toStr}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    },
    auth,
  );
}
