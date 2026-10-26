import { withStaffPermission } from '@/domain/admin/guard';
import { globalSearch } from '@/domain/admin/search';
import type { Db } from '@/server/db/connection';
import { enforceRateLimit } from '@/server/http/rate-limit';

/** Не более 60 запросов в минуту на сотрудника (поиск по мере набора, с debounce на клиенте). */
export const SEARCH_RATE_LIMIT = 60;

/**
 * GET /admin/api/search?q= — подсказки глобального поиска. Нужна сессия сотрудника; какие типы объектов
 * вернутся, решают права внутри globalSearch (без права тип не запрашивается).
 */
export function createSearchHandler(opts: { db?: Db; now?: number } = {}) {
  const auth = opts.db ? { db: opts.db, ...(opts.now !== undefined ? { now: opts.now } : {}) } : {};
  return withStaffPermission(
    'staff.self',
    (req, session) => {
      enforceRateLimit(`admin-search:${session.staffId}`, SEARCH_RATE_LIMIT, 60, { db: opts.db, now: opts.now });
      const q = new URL(req.url).searchParams.get('q');
      return Response.json(globalSearch(session, q, { db: opts.db }), { headers: { 'Cache-Control': 'no-store' } });
    },
    auth,
  );
}
