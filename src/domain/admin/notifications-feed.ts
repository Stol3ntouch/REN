import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import type { Db } from '@/server/db/connection';
import { countFiltered, listForStaff, markAllRead, markRead, typesForStaff, unreadCount, type NotificationForStaff } from './notifications';

type Opts = { db?: Db; now?: number };

export const FEED_PAGE_SIZE = 20;
export const BELL_LATEST = 6;

/** Человекочитаемые названия типов для фильтра; неизвестный тип показывается как есть. */
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  'order.created': 'Новый заказ',
  'request.created': 'Новое обращение или заявка',
  'import.failed': 'Ошибка импорта',
  'integration.failed': 'Ошибка интеграции',
  'payment.failed': 'Ошибка платежа',
};
export const typeLabel = (type: string): string => NOTIFICATION_TYPE_LABELS[type] ?? type;

export type FeedFilter = { state: 'all' | 'unread' | 'read'; type: string | null; page: number };

/** Фильтр страницы из адресной строки: ?state=unread|read&type=order.created&page=2. Лишнее отбрасывается. */
export function parseFeedFilter(sp: Record<string, unknown>): FeedFilter {
  const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
  const state = first(sp.state);
  const type = first(sp.type);
  const page = Number(first(sp.page));
  return {
    state: state === 'unread' || state === 'read' ? state : 'all',
    type: typeof type === 'string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(type) ? type : null,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export type Feed = { items: NotificationForStaff[]; total: number; unread: number; page: number; pages: number; types: { type: string; label: string }[] };

export const notificationsFeed = {
  /** Страница уведомлений: только адресованные сотруднику (audience), по праву notifications.read. */
  page(session: StaffSession | null, f: FeedFilter, opts: Opts = {}): Feed {
    requirePermission(session, 'notifications.read');
    const total = countFiltered(session.staffId, { unreadOnly: f.state === 'unread', readOnly: f.state === 'read', ...(f.type ? { type: f.type } : {}) }, opts);
    const pages = Math.max(1, Math.ceil(total / FEED_PAGE_SIZE));
    const page = Math.min(f.page, pages);
    const items = listForStaff(
      session.staffId,
      { unreadOnly: f.state === 'unread', readOnly: f.state === 'read', ...(f.type ? { type: f.type } : {}), limit: FEED_PAGE_SIZE, offset: (page - 1) * FEED_PAGE_SIZE },
      opts,
    );
    return { items, total, unread: unreadCount(session.staffId, opts), page, pages, types: typesForStaff(session.staffId, opts).map((type) => ({ type, label: typeLabel(type) })) };
  },

  /** Колокольчик: число непрочитанных и последние записи. */
  summary(session: StaffSession | null, opts: Opts = {}): { unread: number; latest: NotificationForStaff[] } {
    requirePermission(session, 'notifications.read');
    return { unread: unreadCount(session.staffId, opts), latest: listForStaff(session.staffId, { limit: BELL_LATEST }, opts) };
  },

  markRead(session: StaffSession | null, id: number, opts: Opts = {}): { ok: boolean; unread: number } {
    requirePermission(session, 'notifications.read');
    const ok = markRead(session.staffId, id, opts);
    return { ok, unread: unreadCount(session.staffId, opts) };
  },

  markAllRead(session: StaffSession | null, opts: Opts = {}): { marked: number; unread: number } {
    requirePermission(session, 'notifications.read');
    const marked = markAllRead(session.staffId, opts);
    return { marked, unread: unreadCount(session.staffId, opts) };
  },
};
