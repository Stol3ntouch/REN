import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, HSTS_VALUE } from '@/domain/seo/headers';
import { isNoindexPath } from '@/domain/seo/paths';
import { isProductionEnv } from '@/server/config';

/** Адрес проверки живости: балансировщик ходит на него по http внутри сети, редирект ему не нужен. */
const HEALTH_PATH = '/api/health';

function httpsTarget(request: NextRequest): URL {
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, 'https://placeholder.invalid');
  // Хост берём из SITE_URL, а не из заголовка Host: иначе подменой Host можно увести пользователя на чужой сайт.
  let host = request.nextUrl.host;
  try {
    const configured = process.env.SITE_URL?.trim();
    if (configured) host = new URL(configured).host;
  } catch {
    // некорректный SITE_URL ловит config.ts на старте
  }
  target.host = host;
  return target;
}

/**
 * Вход каждого запроса: HTTP→HTTPS и HSTS (только production), CSP с nonce на запрос,
 * X-Robots-Tag для закрытых разделов. Остальные защитные заголовки — в next.config.ts.
 */
export function proxy(request: NextRequest): NextResponse {
  const production = isProductionEnv();
  const { pathname } = request.nextUrl;

  if (production && request.headers.get('x-forwarded-proto') === 'http' && pathname !== HEALTH_PATH) {
    const redirect = NextResponse.redirect(httpsTarget(request), 301);
    redirect.headers.set('Strict-Transport-Security', HSTS_VALUE);
    return redirect;
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const secure = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const csp = buildCsp({ nonce, development: process.env.NODE_ENV === 'development', upgradeInsecure: production && secure });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  if (production) response.headers.set('Strict-Transport-Security', HSTS_VALUE);
  if (isNoindexPath(pathname)) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = {
  // Без статики Next и логотипов: CSP и редирект им не нужны.
  matcher: ['/((?!_next/static|_next/image|brand/|favicon\\.ico).*)'],
};
