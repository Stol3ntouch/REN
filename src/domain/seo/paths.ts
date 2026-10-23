/** Разделы, закрытые от индексации (правило 10): X-Robots-Tag из proxy и подсказка для robots.txt. */
export const NOINDEX_PREFIXES = ['/admin', '/account', '/cart', '/checkout', '/order', '/pay', '/search', '/favorites', '/compare', '/api'] as const;

/** Что запрещено в robots.txt. /search, /favorites, /compare сюда не входят: роботу нужно увидеть noindex. */
export const ROBOTS_DISALLOW = ['/admin', '/account', '/cart', '/checkout', '/api', '/pay', '/order'] as const;

export function isNoindexPath(pathname: string): boolean {
  return NOINDEX_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
