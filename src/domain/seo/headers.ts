/**
 * Защитные заголовки. Файл без зависимостей: его читает и next.config.ts (без алиаса `@/`), и proxy.
 *
 * ИСТОЧНИКИ, РАЗРЕШЁННЫЕ В CSP (T12 проверяет по этому списку):
 *  - img-src: 'self', data:, blob:, https://champion.ru, https://*.champion.ru (фото каталога, пока нет локальной копии),
 *    https://tile.openstreetmap.org, https://*.tile.openstreetmap.org (плитки карты на /contacts и главной);
 *  - script-src: 'self' + nonce запроса + 'strict-dynamic' (в разработке ещё 'unsafe-eval' для React);
 *  - style-src: 'self' 'unsafe-inline' (style="" в разметке и Leaflet);
 *  - connect-src/font-src/form-action/base-uri: только 'self' (и data: для шрифтов); frame-ancestors и object-src: 'none'.
 * Новый внешний ресурс (аналитика, виджет, другой хост фото) — добавить сюда и в tests/seo/headers.test.ts.
 */

export const IMAGE_SOURCES = [
  "'self'",
  'data:',
  'blob:',
  'https://champion.ru',
  'https://*.champion.ru',
  'https://tile.openstreetmap.org',
  'https://*.tile.openstreetmap.org',
] as const;

/** 365 дней. preload не включаем: это необратимо для домена и решается владельцем сайта. */
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

export type Header = { key: string; value: string };

export function buildCsp(opts: { nonce: string; development: boolean; /** Только когда запрос пришёл по https: на http://localhost директива сломала бы все ресурсы. */ upgradeInsecure?: boolean }): string {
  const script = ["'self'", `'nonce-${opts.nonce}'`, "'strict-dynamic'", ...(opts.development ? ["'unsafe-eval'"] : [])];
  const directives = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${IMAGE_SOURCES.join(' ')}`,
    "font-src 'self' data:",
    // в dev HMR ходит по ws:// на тот же хост
    `connect-src 'self'${opts.development ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.upgradeInsecure && !opts.development ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

/** Заголовки без nonce: подходят для всех ответов, включая статические файлы (next.config.ts). */
export function staticSecurityHeaders(): Header[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ];
}
