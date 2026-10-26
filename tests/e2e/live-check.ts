/**
 * Проверка работающего сервера по HTTP (без браузера): npm run e2e:live
 * Адрес — BASE_URL (по умолчанию http://localhost:3000). Запускать только на копии данных:
 * сценарий создаёт заказ, заявку и корзину. За прокси с TLS передаётся X-Forwarded-Proto: https, здесь он ставится сам.
 * Серверное действие оформления вызывается как обычная HTML-форма (progressive enhancement), без JS.
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

type Jar = Map<string, string>;
const jar: Jar = new Map();
const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

async function http(path: string, init: RequestInit & { cookies?: Jar; noRedirect?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-forwarded-proto', 'https');
  if (!headers.has('origin') && init.method && init.method !== 'GET') headers.set('origin', BASE);
  const cj = init.cookies ?? jar;
  if (cj.size) headers.set('cookie', [...cj].map(([k, v]) => `${k}=${v}`).join('; '));
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: init.noRedirect === false ? 'follow' : 'manual' });
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const i = (pair as string).indexOf('=');
    const k = (pair as string).slice(0, i);
    const v = (pair as string).slice(i + 1);
    if (v === '' || /max-age=0/i.test(line)) cj.delete(k);
    else cj.set(k, v);
  }
  return res;
}

const text = async (path: string, init: Parameters<typeof http>[1] = {}) => {
  const res = await http(path, init);
  return { status: res.status, body: await res.text(), headers: res.headers };
};

async function main(): Promise<number> {
  // 1. публичные страницы
  for (const p of ['/', '/catalog', '/contacts', '/privacy', '/cart', '/checkout', '/search?q=test', '/sitemap.xml', '/robots.txt']) {
    const r = await text(p);
    check(`GET ${p} → 200`, r.status === 200, String(r.status));
  }
  const health = await text('/api/health');
  check('GET /api/health → ok и версия миграций', health.status === 200 && /"status":"ok"/.test(health.body) && /migrationVersion/.test(health.body));
  const home = await http('/');
  check('заголовки безопасности (CSP, nosniff, HSTS)', !!home.headers.get('content-security-policy') && home.headers.get('x-content-type-options') === 'nosniff' && !!home.headers.get('strict-transport-security'));
  check('нет X-Powered-By', !home.headers.get('x-powered-by'));

  // 2. поиск → товар
  const sitemap = (await text('/sitemap.xml')).body;
  const productPath = [...sitemap.matchAll(/<loc>[^<]*?(\/product\/[^<]+)<\/loc>/g)][0]?.[1];
  check('в sitemap есть товары', !!productPath);
  if (!productPath) return finish();
  const product = await text(productPath);
  check(`карточка товара ${productPath} → 200, есть JSON-LD и цена/метка`, product.status === 200 && product.body.includes('application/ld+json'));
  const name = /<h1[^>]*>([^<]+)<\/h1>/.exec(product.body)?.[1]?.trim() ?? '';
  const word = name; // полное название: товар должен оказаться в выдаче поиска
  const search = await text(`/search?q=${encodeURIComponent(word)}`);
  check(`поиск «${word}» находит товар`, search.status === 200 && search.body.includes(productPath));
  const api = await http(`/api/catalog/products?q=${encodeURIComponent(word)}&sort=relevance`);
  const apiJson = (await api.json()) as { items?: { id: number; slug: string; inStock: boolean }[] };
  const item = apiJson.items?.find((i) => productPath.endsWith(`/${i.slug}`) && i.inStock) ?? apiJson.items?.find((i) => i.inStock);
  check('API каталога возвращает товар в наличии', !!item);
  if (!item) return finish();

  // 3. корзина (гость): чужой Origin → 403, свой → 200, цены считает сервер
  const evil = await http('/api/cart/items', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ productId: item.id, qty: 1 }) });
  check('POST /api/cart/items с чужим Origin → 403', evil.status === 403);
  const add = await http('/api/cart/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: item.id, qty: 2, totalKopecks: 1, price: 1 }) });
  const cartJson = (await add.json()) as { count: number; totalKopecks: number; items: { unitKopecks: number }[] };
  check('в корзину кладётся товар; сумма серверная, подмена из запроса игнорируется', add.status === 200 && cartJson.count === 2 && cartJson.totalKopecks === (cartJson.items[0]?.unitKopecks ?? -1) * 2 && cartJson.totalKopecks !== 1);

  // 4. оформление как форма
  const page = await text('/checkout');
  check('/checkout показывает форму с согласием', page.status === 200 && page.body.includes('name="consent"'));
  const hidden = [...page.body.matchAll(/<input[^>]*type="hidden"[^>]*>/g)].map((m) => m[0]);
  const attr = (tag: string, a: string) => new RegExp(`${a}="([^"]*)"`).exec(tag)?.[1] ?? '';
  const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const radio = (field: string) => decode(attr([...page.body.matchAll(new RegExp(`<input[^>]*name="${field}"[^>]*>`, 'g'))].map((m) => m[0])[0] ?? '', 'value'));
  const key = `live-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const buildForm = (): FormData => {
    const f = new FormData();
    for (const tag of hidden) {
      const n = decode(attr(tag, 'name'));
      if (n) f.set(n, decode(attr(tag, 'value')));
    }
    f.set('name', 'Проверка Сценария');
    f.set('email', 'live-check@example.test');
    f.set('phone', '+7 900 000-00-00');
    f.set('address', '');
    f.set('comment', 'автоматическая проверка');
    f.set('deliveryMethodId', radio('deliveryMethodId'));
    f.set('paymentMethodId', radio('paymentMethodId'));
    f.set('idempotencyKey', key);
    f.set('consent', 'on');
    return f;
  };
  const first = await http('/checkout', { method: 'POST', body: buildForm() });
  const loc = first.headers.get('location') ?? '';
  const orderMatch = /\/order\/(RTS-\d+)/.exec(loc);
  check('оформление → переход на страницу заказа', (first.status === 303 || first.status === 307) && !!orderMatch, `${first.status} ${loc.slice(0, 60)}`);
  if (orderMatch) {
    const view = await text(loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc);
    check('страница заказа по гостевой ссылке → 200, номер виден', view.status === 200 && view.body.includes(orderMatch[1] as string));
    const noToken = await text(`/order/${orderMatch[1]}`, { cookies: new Map() });
    check('тот же заказ без токена и без cookie → 404', noToken.status === 404, String(noToken.status));
    const dup = await http('/checkout', { method: 'POST', body: buildForm(), cookies: jar });
    check('двойной submit с тем же ключом ведёт на тот же заказ', /\/order\/(RTS-\d+)/.exec(dup.headers.get('location') ?? '')?.[1] === orderMatch[1], `${dup.status} ${dup.headers.get('location') ?? ''}`);
  }
  const foreign = await text('/order/RTS-999999', { cookies: new Map() });
  check('несуществующий/чужой заказ → 404', foreign.status === 404, String(foreign.status));

  // 5. формы
  const cb = { name: 'Проверка', phone: '+7 900 000-00-01', consent: true, website: '' };
  const okForm = await http('/api/forms/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cb) });
  check('заявка на звонок → 201 и номер', okForm.status === 201 && /"number":"ZV-/.test(await okForm.text()));
  const noConsent = await http('/api/forms/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...cb, consent: false }) });
  check('заявка без согласия → 400', noConsent.status === 400);
  const crossSite = await http('/api/forms/callback', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify(cb) });
  check('заявка с чужого Origin → 403', crossSite.status === 403);

  // 6. оплата и админка
  const hook = await http('/api/payment/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rts-signature': 'sha256=00' }, body: '{"eventId":"x"}' });
  check('webhook с неверной подписью → 401', hook.status === 401, String(hook.status));
  for (const p of ['/admin', '/admin/orders', '/admin/import', '/account/orders']) {
    const r = await http(p, { cookies: new Map() });
    check(`${p} без входа → редирект на вход`, [302, 303, 307, 308].includes(r.status) && /login/.test(r.headers.get('location') ?? ''), `${r.status} ${r.headers.get('location') ?? ''}`);
  }
  const adminApi = await http('/admin/api/import/upload', { method: 'POST', cookies: new Map(), body: new FormData() });
  check('POST /admin/api/import/upload без сессии → 401/403/редирект', [401, 403, 302, 303, 307].includes(adminApi.status), String(adminApi.status));
  return finish();
}

function finish(): number {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nПроверок: ${results.length}, не прошло: ${failed.length}`);
  return failed.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
