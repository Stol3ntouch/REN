'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AdminNavItem } from './nav';

/** Список разделов; текущий помечен aria-current. Пункты уже отфильтрованы по роли на сервере. */
export function AdminNavLinks({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="admin-nav__list">
      {items.map((item) => {
        const current = item.href === '/admin' ? pathname === '/admin' : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.key}>
            <Link href={item.href} aria-current={current ? 'page' : undefined} className="admin-nav__link">
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
