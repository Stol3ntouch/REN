/** Cookie состояния боковой панели: 'collapsed' | 'expanded'. Не секрет, читается сервером, чтобы панель не мигала. */
export const NAV_COOKIE = 'rts_admin_nav';
export const NAV_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const isCollapsedCookie = (value: string | undefined): boolean => value === 'collapsed';

/** Строка для document.cookie. */
export function navCookieString(collapsed: boolean, secure: boolean): string {
  return `${NAV_COOKIE}=${collapsed ? 'collapsed' : 'expanded'}; path=/admin; max-age=${NAV_COOKIE_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
