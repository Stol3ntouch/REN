'use server';

import { notificationsFeed } from '@/domain/admin/notifications-feed';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';

/** Возврат на ту же страницу фильтра: путь берётся только из внутренних адресов /admin/notifications. */
function backOf(form: FormData): string {
  const back = field(form, 'back');
  return /^\/admin\/notifications(\?[A-Za-z0-9=&._%-]*)?$/.test(back) ? back : '/admin/notifications';
}

/** Право notifications.read и принадлежность уведомления сотруднику (audience) проверяет notificationsFeed. */
export async function markNotificationReadAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Уведомление не найдено');
  return runAction(backOf(form), (session) => {
    notificationsFeed.markRead(session, id);
  });
}

export async function markAllNotificationsReadAction(form: FormData): Promise<never> {
  return runAction(backOf(form), (session) => {
    notificationsFeed.markAllRead(session);
  });
}
