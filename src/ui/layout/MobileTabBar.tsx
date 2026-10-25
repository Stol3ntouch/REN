'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CartIcon, GridIcon, HeartIcon, HomeIcon, UserIcon } from './icons';
import { useCounters } from './counters-store';

/** Нижняя панель на телефоне (< 48rem; на широком экране скрыта CSS): Главная / Каталог / Избранное / Корзина / Профиль. */
export function MobileTabBar({ showCart = true }: { showCart?: boolean }) {
  const pathname = usePathname() ?? '/';
  const c = useCounters();
  const tabs = [
    { href: '/', label: 'Главная', icon: <HomeIcon />, count: 0 },
    { href: '/catalog', label: 'Каталог', icon: <GridIcon />, count: 0 },
    { href: '/favorites', label: 'Избранное', icon: <HeartIcon />, count: c.favorites },
    { href: '/cart', label: 'Корзина', icon: <CartIcon />, count: c.cart },
    { href: '/account', label: 'Профиль', icon: <UserIcon />, count: 0 },
  ].filter((t) => showCart || t.href !== '/cart');
  const isCurrent = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav className="mobile-tabbar" aria-label="Быстрая навигация">
      <ul>
        {tabs.map((t) => (
          <li key={t.href}>
            <Link href={t.href} aria-current={isCurrent(t.href) ? 'page' : undefined} aria-label={t.count > 0 ? `${t.label}: ${t.count}` : undefined}>
              <span className="mobile-tabbar__icon">
                {t.icon}
                {t.count > 0 ? (
                  <span className="badge" aria-hidden="true">
                    {t.count > 99 ? '99+' : t.count}
                  </span>
                ) : null}
              </span>
              <span>{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
