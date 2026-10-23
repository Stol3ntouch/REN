'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/account', label: 'Профиль и адреса' },
  { href: '/account/orders', label: 'Мои заказы' },
  { href: '/favorites', label: 'Избранное' },
  { href: '/compare', label: 'Сравнение' },
];

export function AccountNav() {
  const path = usePathname();
  return (
    <nav className="account-nav" aria-label="Разделы кабинета">
      <ul>
        {ITEMS.map((i) => {
          const current = i.href === '/account' ? path === '/account' : path.startsWith(i.href);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={current ? 'page' : undefined}>
                {i.label}
              </Link>
            </li>
          );
        })}
        <li>
          <Link href="/account/logout">Выйти</Link>
        </li>
      </ul>
    </nav>
  );
}
