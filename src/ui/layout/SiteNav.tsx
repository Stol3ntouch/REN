'use client';

import { usePathname } from 'next/navigation';
import { MAIN_NAV } from '../nav';
import type { ShellLink } from '../shell-context';

/**
 * Основное меню. До 64rem — сворачиваемый <details> (работает без JS и с клавиатуры),
 * от 64rem — список в строку. Какой из двух вариантов виден, решает CSS (display:none
 * убирает скрытый из дерева доступности, дублей для скринридера нет).
 * Список приходит из настроек (пустые разделы убраны); без него — стандартное меню.
 * Текущая страница помечена aria-current="page" («Главная» — только на точном «/»).
 */
export function SiteNav({ nav = MAIN_NAV }: { nav?: readonly ShellLink[] }) {
  const pathname = usePathname() ?? '/';
  const aria = (href: string) => {
    const current = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
    return current ? ('page' as const) : undefined;
  };
  return (
    <nav className="site-nav" aria-label="Основное меню">
      <details className="site-nav__mobile">
        <summary className="site-nav__toggle">Меню</summary>
        <ul className="site-nav__list">
          {nav.map((item) => (
            <li key={item.href}>
              <a href={item.href} aria-current={aria(item.href)}>
                {item.label}
              </a>
            </li>
          ))}
          <li>
            <a href="/compare" aria-current={aria('/compare')}>
              Сравнение
            </a>
          </li>
        </ul>
      </details>
      <ul className="site-nav__desktop site-nav__list">
        {nav.map((item) => (
          <li key={item.href}>
            <a href={item.href} aria-current={aria(item.href)}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
