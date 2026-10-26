import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * M01: статическая проверка адаптива. Браузера здесь нет — тест держит на месте правила, без которых на телефоне
 * ломается вёрстка (найдено при проверке на 360/390/768/1024/1440 px, см. scripts/check-responsive.ts):
 *  - meta viewport и вырезы экрана;
 *  - колонки сеток, которые могут сжиматься (иначе длинный select или широкая таблица раздвигает страницу);
 *  - область прокрутки таблиц — контейнер для .visually-hidden (иначе страница «отдаляется» на телефоне);
 *  - поля >= 16px (iOS не зумит), цели касания >= 44px, выдвижное меню, шапка в две строки на узком экране.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Тело блока `@media (...) { ... }` с заданным условием (учитывает вложенные скобки); все такие блоки склеены. */
function mediaBodies(css: string, query: string): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(`@media ${query}`, from);
    if (at < 0) break;
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(open + 1, i - 1));
    from = i;
  }
  return out.join('\n');
}

/** Объявления всех правил с данным селектором внутри фрагмента CSS. */
function declsOf(css: string, selector: string): string {
  const res: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = (m[1] as string).split(',').map((s) => s.trim());
    if (sels.includes(selector)) res.push(m[2] as string);
  }
  return res.join('\n');
}

const adminCss = strip(read('src', 'ui', 'admin', 'admin.css'));
const themeCss = strip(read('src', 'ui', 'theme.css'));
const layoutTsx = read('src', 'app', 'layout.tsx');
const phone = mediaBodies(adminCss, '(max-width: 47.999rem)');
const tablet = mediaBodies(adminCss, '(max-width: 63.999rem)');
const narrow = mediaBodies(adminCss, '(max-width: 29.999rem)');

describe('viewport и вырезы экрана', () => {
  it('корневой layout отдаёт width=device-width, initial-scale=1 и viewport-fit=cover', () => {
    const block = layoutTsx.slice(layoutTsx.indexOf('export const viewport'));
    expect(block).toMatch(/width:\s*'device-width'/);
    expect(block).toMatch(/initialScale:\s*1/);
    expect(block).toMatch(/viewportFit:\s*'cover'/);
    expect(block).not.toMatch(/maximumScale|userScalable:\s*false/); // масштабирование пальцами не запрещаем
  });

  it('шапка, содержимое, окна и уведомления админки учитывают safe-area', () => {
    for (const sel of ['.ak-topbar', '.ak-main', '.ak-toasts', '.ak-modal']) {
      expect(declsOf(adminCss, sel), sel).toMatch(/env\(safe-area-inset-/);
    }
  });

  it('на публичном сайте body не заходит под вырезы', () => {
    expect(declsOf(themeCss, 'body')).toMatch(/env\(safe-area-inset-left/);
  });
});

describe('ничто не раздвигает страницу', () => {
  it('поле формы — сжимаемая колонка, select не шире колонки', () => {
    for (const sel of ['.ak-field', '.adm-field', '.admin-field']) {
      expect(declsOf(adminCss, sel), sel).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    }
    expect(declsOf(adminCss, '.ak-field select')).toMatch(/max-width:\s*100%/);
  });

  it('двухколоночная сетка страниц на телефоне — одна сжимаемая колонка', () => {
    expect(declsOf(adminCss, '.ak-grid-2')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(declsOf(adminCss, '.ak-grid-2 > *')).toMatch(/min-width:\s*0/);
  });

  it('область прокрутки таблицы: overflow-x и position: relative (контейнер для .visually-hidden)', () => {
    expect(declsOf(adminCss, '.ak-tablewrap')).toMatch(/overflow-x:\s*auto/);
    expect(declsOf(adminCss, '.ak-tablewrap')).toMatch(/position:\s*relative/);
    const adm = read('src', 'ui', 'cart', 'admin-orders.css');
    expect(declsOf(strip(adm), '.adm-table-wrap')).toMatch(/overflow-x:\s*auto/);
    expect(declsOf(adminCss, '.adm-table-wrap')).toMatch(/position:\s*relative/);
  });

  it('публичный сайт не создаёт горизонтальную прокрутку', () => {
    expect(declsOf(themeCss, 'body')).toMatch(/overflow-x:\s*clip/);
  });

  it('ни один стиль не задаёт фиксированную ширину шире экрана 360 px', () => {
    const files = [
      ['src', 'ui', 'admin', 'admin.css'],
      ['src', 'ui', 'admin', 'c10.css'],
      ['src', 'ui', 'catalog', 'catalog.css'],
      ['src', 'ui', 'home', 'home.css'],
      ['src', 'ui', 'layout', 'layout.css'],
      ['src', 'ui', 'cart', 'cart.css'],
      ['src', 'ui', 'forms', 'forms.css'],
    ];
    for (const f of files) {
      const css = strip(read(...f));
      const bad = [...css.matchAll(/(?<![-\w])(?:min-)?width:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => Number(m[1]) > 340);
      expect(bad.map((m) => m[0]), f.join('/')).toEqual([]);
    }
  });
});

describe('публичный сайт', () => {
  const layoutCss = strip(read('src', 'ui', 'layout', 'layout.css'));

  it('карточка товара на телефоне — сжимаемая колонка (ряд миниатюр не раздвигает страницу)', () => {
    const phoneGrids = mediaBodies(themeCss, '(max-width: 47.999rem)');
    const sel = [...phoneGrids.matchAll(/([^{}]+)\{([^{}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^{}]*)\}/g)].map((m) => m[1]).join(',');
    for (const c of ['.product-top', '.cart-layout', '.checkout-layout', '.account']) expect(sel, c).toContain(c);
    expect(declsOf(strip(read('src', 'ui', 'catalog', 'catalog.css')), '.gallery__thumbs')).toMatch(/overflow-x:\s*auto/);
  });

  it('планшет: поиск в шапке не сжимается — вторая строка шапки', () => {
    const tab = mediaBodies(layoutCss, '(min-width: 48rem) and (max-width: 63.999rem)');
    expect(declsOf(tab, '.site-search')).toMatch(/grid-row:\s*2/);
    expect(declsOf(tab, '.header-counters')).toMatch(/grid-row:\s*1/);
  });

  it('нижняя панель телефона: подписи не переносятся, учтён вырез экрана', () => {
    expect(declsOf(layoutCss, '.mobile-tabbar a')).toMatch(/white-space:\s*nowrap/);
    expect(declsOf(layoutCss, '.mobile-tabbar')).toMatch(/env\(safe-area-inset-bottom/);
  });
});

describe('выдвижное меню и шапка админки', () => {
  it('до 1024 px боковая панель — выдвижная (fixed, за краем экрана), бургер виден', () => {
    expect(declsOf(tablet, '.ak-sidebar')).toMatch(/position:\s*fixed/);
    expect(declsOf(tablet, '.ak-sidebar')).toMatch(/translateX\(-/);
    expect(declsOf(tablet, '.ak-overlay')).toMatch(/position:\s*fixed/);
    expect(declsOf(adminCss, '.ak-iconbtn.ak-burger')).toMatch(/display:\s*none/);
    expect(declsOf(tablet, '.ak-iconbtn.ak-burger')).toMatch(/display:\s*inline-grid/);
  });

  it('на узком телефоне поиск уходит во вторую строку шапки', () => {
    expect(declsOf(narrow, '.ak-topbar')).toMatch(/flex-wrap:\s*wrap/);
    expect(declsOf(narrow, '.ak-topbar__slot')).toMatch(/flex:\s*1 0 100%/);
  });

  it('выпадающие панели поиска и уведомлений не уезжают за край экрана', () => {
    const body = declsOf(tablet, '.ak-app .ak-bell__panel');
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/left:/);
    expect(body).toMatch(/right:/);
  });

  it('диалог подтверждения на телефоне — снизу, кнопки на всю ширину', () => {
    expect(declsOf(phone, '.ak-modal')).toMatch(/place-items:\s*end center/);
    expect(declsOf(phone, '.ak-dialog__actions > .ak-btn')).toMatch(/width:\s*100%/);
  });

  it('панель сохранения: кнопки в один ряд, а не стопкой', () => {
    expect(declsOf(phone, '.ak-savebar__actions')).toMatch(/flex-wrap:\s*nowrap/);
  });
});

describe('поля и цели касания', () => {
  it('на планшете и телефоне поля ввода >= 16px', () => {
    const sel = [...tablet.matchAll(/([^{}]+)\{([^{}]*font-size:\s*1rem[^{}]*)\}/g)].map((m) => m[1]).join(',');
    expect(sel).toMatch(/\.ak-app select/);
    expect(sel).toMatch(/\.ak-app textarea/);
    expect(sel).toMatch(/\.ak-app input:not\(/);
    expect(themeCss).toMatch(/input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*max\(1rem,\s*16px\)/);
  });

  it('высота управления на планшете и телефоне — 44 px', () => {
    expect(declsOf(adminCss, '.ak-app')).toMatch(/--ak-control-h:\s*2\.75rem/);
    expect(declsOf(tablet, '.ak-btn--sm')).toMatch(/min-height:\s*var\(--ak-control-h\)/);
    expect(declsOf(tablet, '.ak-nav__link')).toMatch(/min-height:\s*2\.75rem/);
    expect(declsOf(tablet, '.ak-tabs__tab')).toMatch(/min-height:\s*2\.75rem/);
  });

  it('переключатель: зона касания 44 px больше самого переключателя', () => {
    expect(declsOf(tablet, '.ak-switch::after')).toMatch(/inset:\s*-0\.625rem/);
  });

  it('публичный сайт: телефон, почта и малые кнопки >= 44 px на телефоне', () => {
    const phoneTheme = mediaBodies(themeCss, '(max-width: 63.999rem)');
    expect(phoneTheme).toMatch(/a\[href\^='tel:'\]/);
    expect(declsOf(phoneTheme, '.button--small')).toMatch(/min-height:\s*var\(--tap-size\)/);
    expect(themeCss).toMatch(/--tap-size:\s*2\.75rem/);
  });
});
