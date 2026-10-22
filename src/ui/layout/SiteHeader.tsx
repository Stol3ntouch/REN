import Link from 'next/link';
import { CALLBACK_HREF, CART_HREF, LOGIN_HREF, SEARCH_ACTION } from '../nav';
import { Placeholder } from '../placeholder';
import { DEFAULT_SHELL, type ShellContext } from '../shell-context';
import { SiteNav } from './SiteNav';

/** Шапка: адрес, телефон, «Заказать звонок», вход, поиск; затем логотип и меню. */
export function SiteHeader({ shell = DEFAULT_SHELL }: { shell?: ShellContext }) {
  return (
    <header className="site-header">
      <div className="site-header__bar">
        <div className="site-header__top container">
          <p className="site-header__contact">
            <span className="site-header__address">{shell.address ?? <Placeholder label="АДРЕС" />}</span>
            <span className="site-header__phone">
              {shell.phone ? (
                <a href={`tel:${shell.phone.replace(/[^\d+]/g, '')}`}>{shell.phone}</a>
              ) : (
                <Placeholder label="ТЕЛЕФОН" />
              )}
            </span>
          </p>
          <div className="site-header__actions">
            <a className="button button--outline" href={CALLBACK_HREF}>
              Заказать звонок
            </a>
            <a href={LOGIN_HREF}>Вход</a>
            <a href={CART_HREF}>Корзина</a>
          </div>
        </div>
      </div>
      <div className="site-header__main container">
        <Link className="site-header__logo" href="/" aria-label={`${shell.siteName} — на главную`}>
          {shell.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- логотип загружается в админке, высота задана
            <img src={shell.logoUrl} alt={shell.siteName} height={48} />
          ) : (
            <Placeholder label="ЛОГОТИП" verb="загрузи" />
          )}
        </Link>
        <form className="site-search" role="search" action={SEARCH_ACTION} method="get">
          <label className="visually-hidden" htmlFor="site-search">
            Поиск по каталогу
          </label>
          <input id="site-search" name="q" type="search" placeholder="Название, модель или артикул" autoComplete="off" />
          <button className="button" type="submit">
            Найти
          </button>
        </form>
        <SiteNav />
      </div>
    </header>
  );
}
