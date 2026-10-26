/**
 * M01: обход маршрутов на 360 / 768 / 1024 px с проверкой «страница не шире экрана».
 *
 *   npm run check:responsive -- --base http://localhost:4700 [--admin-login <логин> --admin-password <пароль>] [--widths 360,768,1024]
 *   либо переменные CHECK_BASE_URL, CHECK_ADMIN_LOGIN, CHECK_ADMIN_PASSWORD.
 *
 * Playwright НЕ входит в зависимости проекта. Если пакета `playwright` (или `@playwright/test`) нет — скрипт
 * сообщает об этом и выходит с кодом 0 (пропуск), ничего не устанавливая. Браузер должен быть уже скачан.
 * Проверяется: document.documentElement.scrollWidth <= innerWidth, нет элементов правее края экрана вне областей
 * прокрутки, поля ввода >= 16px на ширинах до 768 px. Админка проходится, только если заданы логин и пароль
 * (администратор создаётся `npm run admin:create` на копии БД, не на рабочей).
 */

/** Минимум API Playwright, который нужен скрипту (пакет не в зависимостях, типов нет). */
type Page = {
  goto(url: string, o?: object): Promise<unknown>;
  fill(sel: string, v: string): Promise<void>;
  click(sel: string): Promise<void>;
  waitForURL(f: (u: URL) => boolean, o?: object): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  evaluate(expr: string): Promise<unknown>;
  url(): string;
};
type Browser = { newContext(o?: object): Promise<{ newPage(): Promise<Page> }>; close(): Promise<void> };
type PlaywrightModule = { chromium?: { launch(o?: object): Promise<Browser> }; default?: { chromium?: { launch(o?: object): Promise<Browser> } } };

type Row = { url: string; width: number; ok: boolean; note: string };

const args = process.argv.slice(2);
const arg = (name: string, env: string, fallback = ''): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : (process.env[env] ?? fallback);
};

const BASE = arg('base', 'CHECK_BASE_URL', 'http://localhost:3000').replace(/\/$/, '');
const WIDTHS = arg('widths', 'CHECK_WIDTHS', '360,768,1024').split(',').map(Number).filter((n) => n > 0);
const LOGIN = arg('admin-login', 'CHECK_ADMIN_LOGIN');
const PASSWORD = arg('admin-password', 'CHECK_ADMIN_PASSWORD');

export const SHOP_ROUTES = [
  '/', '/catalog', '/search?q=пила', '/cart', '/checkout', '/favorites', '/compare', '/news', '/promotions', '/services',
  '/about', '/about/reviews', '/contacts', '/buyers', '/privacy', '/pages/faq', '/pages/delivery-payment',
  '/account/login', '/account/register', '/account/forgot', '/этой-страницы-нет',
];

export const ADMIN_ROUTES = [
  '/admin', '/admin/catalog', '/admin/catalog/products/new', '/admin/catalog/categories', '/admin/catalog/brands',
  '/admin/catalog/attributes', '/admin/catalog/filters', '/admin/orders', '/admin/customers', '/admin/inquiries',
  '/admin/repairs', '/admin/requests', '/admin/questions', '/admin/reviews', '/admin/promos', '/admin/content',
  '/admin/content/news', '/admin/content/pages', '/admin/content/promotions', '/admin/import', '/admin/roles',
  '/admin/staff', '/admin/notifications', '/admin/warehouse', '/admin/integrations', '/admin/mail', '/admin/analytics',
  '/admin/audit', '/admin/profile', '/admin/settings', '/admin/settings/store', '/admin/settings/seo',
  '/admin/settings/email', '/admin/settings/payments', '/admin/settings/shipping', '/admin/settings/taxes',
  '/admin/settings/warehouses', '/admin/settings/backup',
];

/** Выполняется в странице: возвращает описание нарушений или пустую строку. */
const MEASURE = `(() => {
  const w = innerWidth, de = document.documentElement, notes = [];
  if (de.scrollWidth > w + 1) notes.push('scrollWidth ' + de.scrollWidth + ' > ' + w);
  const bad = [];
  for (const el of document.body.querySelectorAll('*')) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height || b.right <= w + 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let p = el.parentElement, scroller = false;
    while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { scroller = true; break; } p = p.parentElement; }
    if (!scroller) bad.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '') + ':' + Math.round(b.right));
  }
  if (bad.length) notes.push('вне экрана: ' + bad.slice(0, 4).join(', '));
  if (w < 768) {
    const small = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]),select,textarea')]
      .filter((el) => el.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(el).fontSize) < 16);
    if (small.length) notes.push('поля < 16px: ' + small.length);
  }
  return notes.join('; ');
})()`;

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    try {
      // имя в переменной: TypeScript не ищет типы, пакет не обязателен
      return (await import(/* webpackIgnore: true */ name as string)) as PlaywrightModule;
    } catch {
      /* не установлен */
    }
  }
  return null;
}

async function main(): Promise<number> {
  const pw = await loadPlaywright();
  if (!pw) {
    console.log('check-responsive: Playwright не установлен — проверка пропущена (устанавливать его не нужно).');
    console.log('Статическая проверка правил адаптива: npx vitest run tests/a11y/responsive-css.test.ts.');
    return 0;
  }
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) {
    console.log('check-responsive: в пакете нет chromium — проверка пропущена.');
    return 0;
  }
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.log(`check-responsive: браузер Playwright не запускается (${(e as Error).message.split('\n')[0]}) — проверка пропущена.`);
    return 0;
  }
  const rows: Row[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 800 } });
    const page = await context.newPage();
    const routes = [...SHOP_ROUTES];
    if (LOGIN && PASSWORD) {
      await page.goto(`${BASE}/admin/login`);
      await page.fill('input[type=text], input[type=email]', LOGIN);
      await page.fill('input[type=password]', PASSWORD);
      await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith('/login'), { timeout: 15000 }).catch(() => undefined), page.click('button[type=submit]')]);
      if (page.url().includes('/admin/login')) console.log('check-responsive: вход в админку не удался — админка пропущена.');
      else routes.push(...ADMIN_ROUTES);
    } else {
      console.log('check-responsive: логин админки не задан — проверяется только публичный сайт.');
    }
    for (const url of routes) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        try {
          await page.goto(BASE + url, { waitUntil: 'load', timeout: 30000 });
          await page.waitForTimeout(300);
          const note = (await page.evaluate(MEASURE)) as string;
          rows.push({ url, width, ok: note === '', note });
        } catch (e) {
          rows.push({ url, width, ok: false, note: `не открылась: ${(e as Error).message.split('\n')[0]}` });
        }
      }
    }
  } finally {
    await browser.close();
  }
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'}\t${r.width}\t${r.url}${r.note ? `\t${r.note}` : ''}`);
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\ncheck-responsive: ${rows.length - failed}/${rows.length} без замечаний`);
  return failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => {
  console.error(e);
  process.exit(1);
});
