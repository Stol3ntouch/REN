import Link from 'next/link';
import { CALLBACK_HREF, LOGIN_HREF, SEARCH_ACTION } from '../nav';
import { Placeholder } from '../placeholder';
import { DEFAULT_SHELL, type ShellContext } from '../shell-context';
import { ArrowRightIcon, MenuLinesIcon, PhoneIcon, PinIcon, SearchIcon } from '../home/home-icons';
import { HeaderCounters } from './HeaderCounters';
import { UserIcon } from './icons';
import { SiteNav } from './SiteNav';

const telOf = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * Шапка: контактная полоса (адрес, телефон, «Заказать звонок», вход), затем логотип, «Каталог», поиск,
 * счётчики (избранное, сравнение, корзина) и меню. Данные — из настроек магазина; нет данных — метка-заглушка.
 */
export function SiteHeader({ shell = DEFAULT_SHELL }: { shell?: ShellContext }) {
  return (
    <header className="site-header" id="top">
      <div className="site-header__bar">
        <div className="site-header__top container">
          <p className="site-header__contact">
            <span className="site-header__address">
              <PinIcon size={16} />
              {shell.address ?? <Placeholder label="АДРЕС" />}</span>
            <span className="site-header__phone">
              <PhoneIcon size={16} />
              {shell.phone ? <a href={shell.phoneHref ?? telOf(shell.phone)}>{shell.phone}</a> : <Placeholder label="ТЕЛЕФОН" />}
            </span>
          </p>
          <div className="site-header__actions">
            <a className="button button--outline button--small" href={CALLBACK_HREF}>
              Заказать звонок
            </a>
            <Link className="site-header__login" href={LOGIN_HREF}>
              <UserIcon />
              Вход
            </Link>
          </div>
        </div>
      </div>
      <div className="site-header__main container">
        <Link className="site-header__logo" href="/" aria-label={`${shell.siteName} — на главную`}>
          {shell.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- логотип загружается в админке, размеры заданы
            <img src={shell.logoUrl} alt={shell.siteName} height={48} />
          ) : (
            <Placeholder label="ЛОГОТИП" verb="загрузи" />
          )}
        </Link>
        <Link className="button site-header__catalog" href="/catalog">
          <MenuLinesIcon size={20} />
          Каталог
          <ArrowRightIcon size={18} />
        </Link>
        <form className="site-search" role="search" action={SEARCH_ACTION} method="get">
          <label className="visually-hidden" htmlFor="site-search">
            Поиск по каталогу
          </label>
          <input id="site-search" name="q" type="search" placeholder="Поиск товаров…" autoComplete="off" />
          <button className="button site-search__submit" type="submit">
            <SearchIcon size={20} />
            <span className="visually-hidden">Найти</span>
          </button>
        </form>
        <HeaderCounters />
      </div>
      <div className="site-header__nav container">
        <SiteNav nav={shell.nav} />
      </div>
    </header>
  );
}
