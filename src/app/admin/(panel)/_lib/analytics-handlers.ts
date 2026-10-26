import { withStaffPermission } from '@/domain/admin/guard';
import { parseBucket, parseRange } from '@/domain/analytics';
import { STATS_CSV_KINDS, statsOps, type StatsCsvKind } from '@/domain/analytics/stats';
import type { Db } from '@/server/db/connection';
import { ValidationError } from '@/server/http/errors';

/**
 * GET /admin/analytics/export?kind=series|categories|products|cancellations|statuses|stock&from=&to=&by=day|week|month — CSV (UTF-8 с BOM).
 * Право (stats.read + export.run либо analytics.read; деньги — ещё и finance.read) проверяет statsOps внутри; здесь достаточно сессии.
 */
export function createAnalyticsExportHandler(opts: { db?: Db; now?: number } = {}) {
  const auth = opts.db ? { db: opts.db, ...(opts.now !== undefined ? { now: opts.now } : {}) } : {};
  return withStaffPermission(
    'staff.self',
    (req, session) => {
      const url = new URL(req.url);
      const kind = url.searchParams.get('kind') ?? '';
      if (!(STATS_CSV_KINDS as readonly string[]).includes(kind)) throw new ValidationError('Неизвестный вид выгрузки');
      const range = parseRange(Object.fromEntries(url.searchParams), opts.now ?? Date.now());
      const csv = statsOps.exportCsv(session, kind as StatsCsvKind, range, parseBucket(url.searchParams.get('by')), { db: opts.db });
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

/** GET /admin/api/stats?from=&to=&by= — JSON-отчёт статистики для текущего сотрудника (права применяет statsOps). */
export function createStatsJsonHandler(opts: { db?: Db; now?: number } = {}) {
  const auth = opts.db ? { db: opts.db, ...(opts.now !== undefined ? { now: opts.now } : {}) } : {};
  return withStaffPermission(
    'staff.self',
    (req, session) => {
      const url = new URL(req.url);
      const range = parseRange(Object.fromEntries(url.searchParams), opts.now ?? Date.now());
      const report = statsOps.report(session, range, parseBucket(url.searchParams.get('by')), { db: opts.db });
      return Response.json({ range: { from: range.fromStr, to: range.toStr }, report }, { headers: { 'Cache-Control': 'no-store' } });
    },
    auth,
  );
}
