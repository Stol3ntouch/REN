import Link from 'next/link';

/** Вкладки «Настройки магазина»: ведут на страницы своих разделов (C11 — основные и SEO, остальные — C12). */
export const SETTINGS_TABS = [
  { key: 'store', label: 'Основные настройки', href: '/admin/settings/store' },
  { key: 'shipping', label: 'Доставка', href: '/admin/settings/shipping' },
  { key: 'payments', label: 'Способы оплаты', href: '/admin/settings/payments' },
  { key: 'warehouses', label: 'Склады и остатки', href: '/admin/settings/warehouses' },
  { key: 'taxes', label: 'Налоги и цены', href: '/admin/settings/taxes' },
  { key: 'email', label: 'Email и уведомления', href: '/admin/settings/email' },
  { key: 'seo', label: 'SEO и метаданные', href: '/admin/settings/seo' },
  { key: 'backup', label: 'Резервные копии', href: '/admin/settings/backup' },
] as const;

export function SettingsTabs({ current }: { current: (typeof SETTINGS_TABS)[number]['key'] }) {
  return (
    <nav className="ak-tabs" aria-label="Разделы настроек магазина">
      <ul>
        {SETTINGS_TABS.map((t) => (
          <li key={t.key}>
            <Link className="ak-tabs__tab" href={t.href} aria-current={t.key === current ? 'page' : undefined} prefetch={false}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
