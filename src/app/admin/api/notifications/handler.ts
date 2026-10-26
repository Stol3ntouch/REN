import { withStaffPermission } from '@/domain/admin/guard';
import { notificationsFeed } from '@/domain/admin/notifications-feed';
import type { Db } from '@/server/db/connection';
import { ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };
const auth = (o: Opts) => (o.db ? { db: o.db, ...(o.now !== undefined ? { now: o.now } : {}) } : {});
const noStore = { 'Cache-Control': 'no-store' };

/** GET /admin/api/notifications — число непрочитанных и последние уведомления сотрудника (polling колокольчика). */
export function createNotificationsGetHandler(o: Opts = {}) {
  return withStaffPermission('notifications.read', (_req, session) => Response.json(notificationsFeed.summary(session, o), { headers: noStore }), auth(o));
}

/** POST /admin/api/notifications  {"id": 5} — прочитано; {"all": true} — прочитаны все. Origin проверяет обёртка. */
export function createNotificationsPostHandler(o: Opts = {}) {
  return withStaffPermission(
    'notifications.read',
    async (req, session) => {
      const body = (await req.json().catch(() => null)) as { id?: unknown; all?: unknown } | null;
      if (body?.all === true) return Response.json(notificationsFeed.markAllRead(session, o), { headers: noStore });
      if (typeof body?.id === 'number' && Number.isInteger(body.id) && body.id > 0) return Response.json(notificationsFeed.markRead(session, body.id, o), { headers: noStore });
      throw new ValidationError('Укажите id уведомления или all: true');
    },
    auth(o),
  );
}
