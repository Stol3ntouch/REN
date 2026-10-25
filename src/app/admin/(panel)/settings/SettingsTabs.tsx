import Link from 'next/link';

/** Вкладки «Настройки магазина»: ведут на страницы своих разделов (C11 — основные и SEO, остальные — C12). */
export const SETTINGS_TABS = [
  { key: 'store', label: 'Основные настройки', href: '/admin/settings/store' },
  { key: 'shipping', label: 'Доставка и оплата', href: '/admin/settings/shipping' },
  { key: 'payments', label: 'Способы оплаты', href: '/admin/settings/payments' },
  { key: 'warehouses', label: 'Склады и остатки', href: '/admin/warehouse' },
  { key: 'taxes', label: 'Налоги и цены', href: '/admin/settings/taxes' },
  { key: 'email', label: 'Email и уведомления', href: '/admin/mail' },
  { key: 'seo', label: 'SEO и метаданные', href: '/admin/settings/seo' },
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
