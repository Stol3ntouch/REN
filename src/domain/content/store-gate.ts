import { getShopInfo, type ShopInfo } from './settings';
import { getStoreFlags } from './store-flags';
import { getDb, type Db } from '@/server/db/connection';
import { settingsRepo } from '@/server/db/repositories/settings';

/**
 * Серверные ограничения витрины по переключателям (вызывается из proxy на каждый запрос):
 *  - «Включить магазин» выключен → 503 «Магазин временно закрыт»;
 *  - «Режим технического обслуживания» → 503 всем, кроме сотрудников с активной сессией;
 *  - «Показывать цены» выключен → корзина и оформление отвечают отказом (403).
 * Админка, проверка живости, вебхуки оплаты, статика и служебные файлы поисковиков не затрагиваются.
 */
export type GateDecision =
  | { kind: 'pass' }
  | { kind: 'page'; status: number; reason: 'closed' | 'maintenance' | 'prices_hidden'; retryAfterSec?: number }
  | { kind: 'json'; status: number; code: string; message: string };

const startsWithPath = (pathname: string, prefix: string): boolean => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Что открыто при закрытом магазине и обслуживании. */
const ALWAYS_OPEN = ['/admin', '/api/health', '/api/payment', '/api/catalog/media', '/brand', '/_next', '/robots.txt', '/sitemap.xml', '/favicon.ico'] as const;

/** Адреса корзины и оформления: при скрытых ценах недоступны. */
const CART_PAGES = ['/cart', '/checkout'] as const;

export const CLOSED_TITLE = 'Магазин временно закрыт';
export const MAINTENANCE_TITLE = 'Технические работы';
export const MAINTENANCE_DEFAULT_MESSAGE = 'Сайт временно недоступен: мы проводим технические работы. Скоро вернёмся.';
export const PRICES_HIDDEN_MESSAGE = 'Оформление заказа сейчас недоступно.';

export function decideStoreGate(
  input: { pathname: string; isStaff: () => boolean },
  opts: { db?: Db; now?: number } = {},
): GateDecision {
  const { pathname } = input;
  let flags;
  try {
    flags = getStoreFlags(opts);
  } catch {
    return { kind: 'pass' }; // БД недоступна: проверку живости и остальное решают сами обработчики
  }
  const open = ALWAYS_OPEN.some((p) => startsWithPath(pathname, p));
  if (!open) {
    if (!flags.storeEnabled) return { kind: 'page', status: 503, reason: 'closed', retryAfterSec: 3600 };
    if (flags.maintenance && !input.isStaff()) return { kind: 'page', status: 503, reason: 'maintenance', retryAfterSec: 600 };
  }
  if (!flags.showPrices) {
    if (startsWithPath(pathname, '/api/cart')) return { kind: 'json', status: 403, code: 'prices_hidden', message: PRICES_HIDDEN_MESSAGE };
    if (CART_PAGES.some((p) => startsWithPath(pathname, p))) return { kind: 'page', status: 403, reason: 'prices_hidden' };
  }
  return { kind: 'pass' };
}

const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function contactsHtml(shop: Pick<ShopInfo, 'phone' | 'phoneHref' | 'address' | 'email'>): string {
  const rows: string[] = [];
  if (shop.phone) rows.push(`<p>Телефон: ${shop.phoneHref ? `<a href="${esc(shop.phoneHref)}">${esc(shop.phone)}</a>` : esc(shop.phone)}</p>`);
  if (shop.address) rows.push(`<p>Адрес: ${esc(shop.address)}</p>`);
  if (shop.email) rows.push(`<p>Email: <a href="mailto:${esc(shop.email)}">${esc(shop.email)}</a></p>`);
  return rows.join('');
}

/** Самодостаточная HTML-страница ответа (без React: proxy отвечает до рендера). Телефон и адрес — из настроек, выдуманных нет. */
export function renderGatePage(
  reason: 'closed' | 'maintenance' | 'prices_hidden',
  ctx: { shop: Pick<ShopInfo, 'siteName' | 'phone' | 'phoneHref' | 'address' | 'email'>; message?: string | null; nonce: string },
): string {
  const title = reason === 'closed' ? CLOSED_TITLE : reason === 'maintenance' ? MAINTENANCE_TITLE : 'Оформление недоступно';
  const message =
    reason === 'closed'
      ? 'Сейчас мы не принимаем заказы. Загляните позже или свяжитесь с нами.'
      : reason === 'maintenance'
        ? ctx.message?.trim() || MAINTENANCE_DEFAULT_MESSAGE
        : PRICES_HIDDEN_MESSAGE;
  const back = reason === 'prices_hidden' ? '<p><a href="/catalog">Вернуться в каталог</a></p>' : '';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} — ${esc(ctx.shop.siteName)}</title>
<style nonce="${esc(ctx.nonce)}">
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f7f4;color:#1c2a1f;display:grid;min-height:100vh;place-items:center;padding:16px}
main{max-width:520px;background:#fff;border-radius:12px;padding:32px 24px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
h1{margin:0 0 12px;font-size:1.5rem}
p{margin:8px 0;line-height:1.5}
a{color:#2f7d32}
.site{font-size:.9rem;color:#5b6b5e;margin:0 0 8px}
</style>
</head>
<body>
<main role="main">
<p class="site">${esc(ctx.shop.siteName)}</p>
<h1>${esc(title)}</h1>
<p>${esc(message)}</p>
${contactsHtml(ctx.shop)}${back}
</main>
</body>
</html>`;
}

/** Ответ для proxy: HTML-страница нужного статуса. БД недоступна — страница без контактов. */
export function gatePageFor(decision: Extract<GateDecision, { kind: 'page' }>, nonce: string, opts: { db?: Db } = {}): { html: string; headers: Record<string, string> } {
  let shop: Pick<ShopInfo, 'siteName' | 'phone' | 'phoneHref' | 'address' | 'email'> = { siteName: 'РемТехСад', phone: null, phoneHref: null, address: null, email: null };
  let message: string | null = null;
  try {
    const db = opts.db ?? getDb();
    shop = getShopInfo({ db });
    message = settingsRepo.get(db, 'maintenance_message');
  } catch {
    // без БД остаётся страница без контактов
  }
  const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
  if (decision.retryAfterSec) headers['retry-after'] = String(decision.retryAfterSec);
  return { html: renderGatePage(decision.reason, { shop, message, nonce }), headers };
}
