'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import '../c10.css';
import { Icon } from './icons';

type Item = { id: number; title: string; body: string | null; href: string | null; severity: 'info' | 'success' | 'warning' | 'error'; createdAt: number; read: boolean };

/** Раз в 45 секунд (в пределах 30–60 с из ТЗ), только пока вкладка видима. Без SSE и WebSocket. */
export const BELL_POLL_MS = 45_000;

const fmt = (ms: number): string => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(ms));

/**
 * Колокольчик уведомлений: число непрочитанных (обновляется опросом /admin/api/notifications), выпадающий список
 * последних, переход к объекту с отметкой «прочитано». Полный список — /admin/notifications.
 */
export function NotificationBell({ unread: initial = 0, href = '/admin/notifications' }: { unread?: number; href?: string }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initial);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/admin/api/notifications', { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { unread: number; latest: Item[] };
      setUnread(data.unread);
      setItems(data.latest);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, BELL_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const post = (body: unknown) => fetch('/admin/api/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const openItem = async (n: Item) => {
    setOpen(false);
    if (!n.read) {
      await post({ id: n.id }).catch(() => undefined);
      void load();
    }
    if (n.href) router.push(n.href);
  };

  const markAll = async () => {
    await post({ all: true }).catch(() => undefined);
    void load();
  };

  const label = unread > 0 ? `Уведомления: непрочитанных ${unread}` : 'Уведомления';
  return (
    <div className="ak-bell" ref={boxRef}>
      <button type="button" className="ak-iconbtn" aria-label={label} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="bell" size={20} />
        {unread > 0 ? (
          <span className="ak-bell__dot" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="ak-bell__panel" role="region" aria-label="Последние уведомления">
          <div className="ak-bell__head">
            <strong>Уведомления</strong>
            {unread > 0 ? (
              <button type="button" className="ak-linkbtn" onClick={markAll}>
                Отметить все прочитанными
              </button>
            ) : null}
          </div>
          {failed ? <p className="ak-bell__note">Не удалось обновить список.</p> : null}
          {items.length === 0 && !failed ? <p className="ak-bell__note">Уведомлений пока нет.</p> : null}
          <ul className="ak-bell__list">
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" className={n.read ? 'ak-bell__item' : 'ak-bell__item is-unread'} data-severity={n.severity} onClick={() => void openItem(n)}>
                  <span className="ak-bell__title">{n.title}</span>
                  {n.body ? <span className="ak-bell__body">{n.body}</span> : null}
                  <time className="ak-bell__time" dateTime={new Date(n.createdAt).toISOString()}>
                    {fmt(n.createdAt)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
          <Link href={href} className="ak-bell__all" onClick={() => setOpen(false)}>
            Все уведомления
          </Link>
        </div>
      ) : null}
    </div>
  );
}
