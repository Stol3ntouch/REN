import { NextResponse, type NextRequest } from 'next/server';
import { getStaffSession } from '@/domain/admin/staff-session';
import { decideStoreGate, gatePageFor } from '@/domain/content/store-gate';
import { buildCsp, HSTS_VALUE } from '@/domain/seo/headers';
import { isNoindexPath } from '@/domain/seo/paths';
import { isProductionEnv } from '@/server/config';

/** Адрес проверки живости: балансировщик ходит на него по http внутри сети, редирект ему не нужен. */
const HEALTH_PATH = '/api/health';

/**
 * Переключатель HTTPS_REDIRECT: значения off / false / 0 (регистр не важен) отключают ТОЛЬКО 301-редирект HTTP→HTTPS.
 * HSTS, CSP и прочие заголовки остаются как есть. Без переменной (или с любым другим значением) редирект
 * в production включён. Использовать лишь за прокси, который терминирует TLS и не умеет передавать верный
 * `x-forwarded-proto` (тестовый туннель localhost.run шлёт `http` и для https-клиентов → бесконечный редирект).
 * В обычном production НЕ отключать. Читается при каждом запросе (runtime), а не на этапе сборки.
 */
function httpsRedirectDisabled(): boolean {
  const value = process.env.HTTPS_REDIRECT?.trim().toLowerCase();
  return value === 'off' || value === 'false' || value === '0';
}

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
 * Вход каждого запроса: HTTP→HTTPS (только production и только по явному `x-forwarded-proto: http`:
 * прокси без заголовка, например localhost.run, иначе зациклил бы редирект) и HSTS (production + https),
 * CSP с nonce на запрос,
 * X-Robots-Tag для закрытых разделов. Остальные защитные заголовки — в next.config.ts.
 */
export function proxy(request: NextRequest): NextResponse {
  const production = isProductionEnv();
  const { pathname } = request.nextUrl;

  if (production && !httpsRedirectDisabled() && request.headers.get('x-forwarded-proto') === 'http' && pathname !== HEALTH_PATH) {
    const redirect = NextResponse.redirect(httpsTarget(request), 301);
    redirect.headers.set('Strict-Transport-Security', HSTS_VALUE);
    return redirect;
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const secure = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const csp = buildCsp({ nonce, development: process.env.NODE_ENV === 'development', upgradeInsecure: production && secure });

  // Переключатели магазина («Включить магазин», «Режим обслуживания», «Показывать цены») действуют на сервере.
  const gate = decideStoreGate({
    pathname,
    isStaff: () => {
      try {
        return getStaffSession(request.cookies) !== null;
      } catch {
        return false;
      }
    },
  });
  if (gate.kind === 'page') {
    const { html, headers } = gatePageFor(gate, nonce);
    const blocked = new NextResponse(html, { status: gate.status, headers });
    blocked.headers.set('Content-Security-Policy', csp);
    if (production && secure) blocked.headers.set('Strict-Transport-Security', HSTS_VALUE);
    return blocked;
  }
  if (gate.kind === 'json') {
    const blocked = NextResponse.json({ error: { code: gate.code, message: gate.message } }, { status: gate.status, headers: { 'cache-control': 'no-store' } });
    blocked.headers.set('Content-Security-Policy', csp);
    return blocked;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  // HSTS только на https: на чистом http (или за прокси без x-forwarded-proto) браузер его игнорирует, а мы не врём о схеме.
  if (production && secure) response.headers.set('Strict-Transport-Security', HSTS_VALUE);
  if (isNoindexPath(pathname)) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = {
  // Без статики Next и логотипов: CSP и редирект им не нужны.
  matcher: ['/((?!_next/static|_next/image|brand/|favicon\\.ico).*)'],
};
