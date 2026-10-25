'use client';

import Link from 'next/link';
import { CartIcon, CompareIcon, HeartIcon } from './icons';
import { useCounters } from './counters-store';

/** Избранное, сравнение, корзина со счётчиками (читаются с сервера; нули не показываются). */
export function HeaderCounters({ showCart = true }: { showCart?: boolean }) {
  const c = useCounters();
  const items = [
    { href: '/favorites', label: 'Избранное', count: c.favorites, icon: <HeartIcon /> },
    { href: '/compare', label: 'Сравнение', count: c.compare, icon: <CompareIcon /> },
    { href: '/cart', label: 'Корзина', count: c.cart, icon: <CartIcon /> },
  ].filter((i) => showCart || i.href !== '/cart');
  return (
    <ul className="header-counters">
      {items.map((i) => (
        <li key={i.href}>
          <Link className="header-counters__link" href={i.href} aria-label={i.count > 0 ? `${i.label}: ${i.count}` : i.label}>
            <span className="header-counters__icon">
              {i.icon}
              {i.count > 0 ? (
                <span className="badge" data-counter={i.href.slice(1)} aria-hidden="true">
                  {i.count > 99 ? '99+' : i.count}
                </span>
              ) : null}
            </span>
            <span className="header-counters__label">{i.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
