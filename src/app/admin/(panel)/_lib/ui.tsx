import Link from 'next/link';
import type { ReactNode } from 'react';
import './ops.css';
import '@/ui/cart/admin-orders.css';

/** Подразделы одного раздела меню (например, «Импорт» и «Интеграции»). current — href активного. */
export function SubNav({ items, current }: { items: { href: string; label: string }[]; current: string }) {
  return (
    <nav aria-label="Подразделы">
      <ul className="ops-subnav">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={i.href === current ? 'page' : undefined}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const INTEGRATION_NAV = [
  { href: '/admin/integrations', label: 'Интеграции' },
  { href: '/admin/import', label: 'Импорт YML' },
];

export const ACCESS_NAV = [
  { href: '/admin/staff', label: 'Сотрудники' },
  { href: '/admin/settings', label: 'Настройки' },
  { href: '/admin/audit', label: 'Журнал аудита' },
];

export const CATALOG_NAV = [
  { href: '/admin/catalog', label: 'Товары' },
  { href: '/admin/warehouse', label: 'Склад' },
];

/** Сообщения после действий: ok=1 — «Сохранено», error — текст ошибки (экранируется React). */
export function Flash({ ok, error, okText = 'Готово.' }: { ok?: string; error?: string; okText?: string }) {
  return (
    <>
      {ok ? (
        <p className="adm-flash" role="status">
          {okText}
        </p>
      ) : null}
      {error ? (
        <p className="adm-flash adm-flash--error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <li className="ops-stat">
      <span className="ops-stat__label">{label}</span>
      <span className="ops-stat__value">{value}</span>
      {hint ? <span className="ops-muted">{hint}</span> : null}
    </li>
  );
}

const MSK = 'Europe/Moscow';
export const fmtTime = (ms: number | null): string =>
  ms === null ? '—' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: MSK }).format(new Date(ms));
export const fmtIso = (iso: string | null): string => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? '—' : fmtTime(t);
};

export const str = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
export const int = (v: string | string[] | undefined, fallback: number): number => {
  const n = Number(str(v));
  return Number.isInteger(n) && n >= 1 ? n : fallback;
};
