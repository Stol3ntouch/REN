import { MAIN_NAV } from '../nav';

/**
 * Основное меню. До 64rem — сворачиваемый <details> (работает без JS и с клавиатуры),
 * от 64rem — список в строку. Какой из двух вариантов виден, решает CSS (display:none
 * убирает скрытый из дерева доступности, дублей для скринридера нет).
 */
export function SiteNav() {
  return (
    <nav className="site-nav" aria-label="Основное меню">
      <details className="site-nav__mobile">
        <summary className="site-nav__toggle">Меню</summary>
        <ul className="site-nav__list">
          {MAIN_NAV.map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
        </ul>
      </details>
      <ul className="site-nav__desktop site-nav__list">
        {MAIN_NAV.map((item) => (
          <li key={item.href}>
            <a href={item.href}>{item.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
