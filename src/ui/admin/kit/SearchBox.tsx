import { Icon } from './icons';

/**
 * Глобальный поиск верхней панели (товары, категории, заказы). Показывается только при `TOPBAR_FEATURES.search`
 * (включает C10 вместе со страницей результатов `/admin/search`). Работает без JS: обычная GET-форма.
 */
export function SearchBox({ action = '/admin/search', placeholder = 'Поиск товаров, категорий, заказов…' }: { action?: string; placeholder?: string }) {
  return (
    <form className="ak-searchbox" role="search" action={action} method="get">
      <label htmlFor="ak-global-search" className="visually-hidden">
        Поиск по админке
      </label>
      <input id="ak-global-search" name="q" type="search" placeholder={placeholder} autoComplete="off" maxLength={200} />
      <button type="submit" className="ak-searchbox__submit" aria-label="Найти">
        <Icon name="search" size={18} />
      </button>
    </form>
  );
}
