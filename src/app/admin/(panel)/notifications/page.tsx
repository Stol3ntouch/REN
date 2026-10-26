import type { Metadata } from 'next';
import Link from 'next/link';
import { notificationsFeed, parseFeedFilter, typeLabel } from '@/domain/admin/notifications-feed';
import { requireStaffPage } from '@/ui/admin/guard';
import '@/ui/admin/c10.css';
import { EmptyState } from '@/ui/states';
import { fmtTime } from '../_lib/ui';
import { markAllNotificationsReadAction, markNotificationReadAction } from './actions';

export const metadata: Metadata = { title: 'Уведомления' };
export const dynamic = 'force-dynamic';

const STATE_LABELS = { all: 'Все', unread: 'Непрочитанные', read: 'Прочитанные' } as const;
const SEVERITY_LABELS = { info: 'Информация', success: 'Успех', warning: 'Предупреждение', error: 'Ошибка' } as const;

export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('notifications.read');
  const sp = await searchParams;
  const filter = parseFeedFilter(sp);
  const feed = notificationsFeed.page(session, filter);

  const link = (over: Partial<{ state: string; type: string | null; page: number }>): string => {
    const p = new URLSearchParams();
    const state = over.state ?? filter.state;
    const type = over.type === undefined ? filter.type : over.type;
    if (state !== 'all') p.set('state', state);
    if (type) p.set('type', type);
    if ((over.page ?? 1) > 1) p.set('page', String(over.page));
    const qs = p.toString();
    return `/admin/notifications${qs ? `?${qs}` : ''}`;
  };
  const here = link({ page: feed.page });

  return (
    <>
      <h1>Уведомления</h1>
      <p className="dash-muted">
        Непрочитанных: {feed.unread}. Показываются только события, адресованные вашей роли. Список обновляется при открытии страницы, значок в верхней панели — раз в минуту.
      </p>

      <nav aria-label="Фильтр по состоянию">
        <ul className="dash-period">
          {(Object.keys(STATE_LABELS) as (keyof typeof STATE_LABELS)[]).map((s) => (
            <li key={s}>
              <Link href={link({ state: s })} aria-current={filter.state === s ? 'true' : undefined}>
                {STATE_LABELS[s]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form method="get" className="nt-filters" aria-label="Фильтр по типу">
        {filter.state !== 'all' ? <input type="hidden" name="state" value={filter.state} /> : null}
        <div className="adm-field">
          <label htmlFor="nt-type">Тип</label>
          <select id="nt-type" name="type" defaultValue={filter.type ?? ''}>
            <option value="">Все типы</option>
            {feed.types.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="button button--outline">
          Применить
        </button>
      </form>
      {feed.unread > 0 ? (
        <form action={markAllNotificationsReadAction} className="nt-filters">
          <input type="hidden" name="back" value={here} />
          <button type="submit" className="button">
            Отметить все прочитанными
          </button>
        </form>
      ) : null}

      {feed.items.length === 0 ? (
        <EmptyState title={feed.total === 0 && filter.state === 'all' && !filter.type ? 'Уведомлений пока нет' : 'По выбранным условиям ничего нет'}>
          <p>Здесь появятся новые заказы, обращения, заявки на ремонт и сообщения об ошибках интеграций.</p>
        </EmptyState>
      ) : (
        <ul className="nt-list">
          {feed.items.map((n) => (
            <li key={n.id} className={n.read ? 'nt-item' : 'nt-item is-unread'} data-severity={n.severity}>
              <div>
                <p className="nt-item__title">{n.href ? <Link href={n.href}>{n.title}</Link> : n.title}</p>
                {n.body ? <p className="dash-muted">{n.body}</p> : null}
                <p className="dash-muted">
                  {typeLabel(n.type)} · {SEVERITY_LABELS[n.severity]} · <time dateTime={new Date(n.createdAt).toISOString()}>{fmtTime(n.createdAt)}</time> · {n.read ? 'прочитано' : 'не прочитано'}
                </p>
              </div>
              {!n.read ? (
                <form action={markNotificationReadAction} className="nt-item__actions">
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="back" value={here} />
                  <button type="submit" className="button button--outline">
                    Отметить прочитанным
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {feed.pages > 1 ? (
        <nav aria-label="Страницы" className="adm-inline">
          {feed.page > 1 ? <Link href={link({ page: feed.page - 1 })}>← Назад</Link> : null}
          <span>
            Страница {feed.page} из {feed.pages}
          </span>
          {feed.page < feed.pages ? <Link href={link({ page: feed.page + 1 })}>Вперёд →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
