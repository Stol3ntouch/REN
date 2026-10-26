import { categoryTreeOps } from '@/app/admin/(panel)/_lib/category-tree-ops';
import { withStaffPermission } from '@/domain/admin/guard';
import { ValidationError } from '@/server/http/errors';
import type { Db } from '@/server/db/connection';
import { enforceRateLimit } from '@/server/http/rate-limit';

/** Не более 240 запросов в минуту на сотрудника: дерево догружается по уровням при раскрытии, поиск — с debounce. */
export const CATEGORY_TREE_RATE_LIMIT = 240;

const noStore = { 'Cache-Control': 'no-store' };

/**
 * GET /admin/api/categories/children?parent=<id|пусто> — подкатегории уровня (пусто — корневые);
 * GET /admin/api/categories/children?q=<текст> — поиск по названию с путём;
 * GET /admin/api/categories/children?path=<id> — цепочка предков (раскрыть дерево до выбранной).
 * Нужна сессия сотрудника и право catalog.read (проверяется ещё раз внутри categoryTreeOps).
 */
export function createCategoryChildrenHandler(opts: { db?: Db; now?: number } = {}) {
  const auth = opts.db ? { db: opts.db, ...(opts.now !== undefined ? { now: opts.now } : {}) } : {};
  return withStaffPermission(
    'catalog.read',
    (req, session) => {
      enforceRateLimit(`admin-categories:${session.staffId}`, CATEGORY_TREE_RATE_LIMIT, 60, { db: opts.db, now: opts.now });
      const params = new URL(req.url).searchParams;
      const db = opts.db ? { db: opts.db } : {};
      const q = params.get('q');
      if (q !== null) return Response.json({ hits: categoryTreeOps.search(session, q, db) }, { headers: noStore });
      const path = params.get('path');
      if (path !== null) {
        const id = Number(path);
        if (!Number.isInteger(id) || id < 1) throw new ValidationError('Категория не найдена');
        return Response.json({ path: categoryTreeOps.path(session, id, db) }, { headers: noStore });
      }
      const raw = params.get('parent');
      let parent: number | null = null;
      if (raw !== null && raw !== '' && raw !== 'root') {
        parent = Number(raw);
        if (!Number.isInteger(parent) || parent < 1) throw new ValidationError('Категория не найдена');
      }
      return Response.json(categoryTreeOps.children(session, parent, db), { headers: noStore });
    },
    auth,
  );
}
