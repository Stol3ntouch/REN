/** Пункты основного меню. Страницы появятся вместе с соответствующими задачами. */
export const MAIN_NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/catalog', label: 'Каталог' },
  { href: '/services', label: 'Ремонт и услуги' },
  { href: '/promotions', label: 'Акции' },
  { href: '/news', label: 'Новости' },
  { href: '/about', label: 'О компании' },
  { href: '/contacts', label: 'Контакты' },
];

export const CALLBACK_HREF = '/contacts#callback';
export const LOGIN_HREF = '/account/login';
export const CART_HREF = '/cart';
export const SEARCH_ACTION = '/search';
