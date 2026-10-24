import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ENTITY_FIELDS } from '@/domain/content/fields';
import { getHomeData } from '@/domain/content/home';
import { getPageByKey, getPublishedService, listPublishedServices } from '@/domain/content/queries';
import { EDITABLE_SETTING_KEYS, getSetting, getShopInfo, setSetting } from '@/domain/content/settings';
import { loadShellContext } from '@/domain/content/shell';
import { listPublicUrls } from '@/domain/content/urls';
import { organizationJsonLd } from '@/domain/seo/jsonld';
import { createTestDb } from '@/server/db/testing';
import { HomeView } from '@/ui/home/HomeView';
import { SiteFooter } from '@/ui/layout/SiteFooter';
import { SiteHeader } from '@/ui/layout/SiteHeader';
import { ShopMap } from '@/ui/map/ShopMapBlock';

const root = process.cwd();
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');
const migration = (prefix: string) => {
  const f = readdirSync(join(root, 'migrations')).find((n) => n.startsWith(prefix));
  if (!f) throw new Error(`нет миграции ${prefix}`);
  return read('migrations', f);
};

describe('G04: часы работы нигде не выводятся', () => {
  it('поля и ключа настроек нет, оболочка и JSON-LD без часов', () => {
    expect(EDITABLE_SETTING_KEYS as readonly string[]).not.toContain('work_hours');
    expect(ENTITY_FIELDS.settings.map((f) => f.name)).not.toContain('work_hours');
    const db = createTestDb();
    const shell = loadShellContext({ db });
    expect('hours' in shell).toBe(false);
    expect('hours' in getShopInfo({ db })).toBe(false);
    expect(JSON.stringify(organizationJsonLd(getShopInfo({ db }), 'https://example.test'))).not.toMatch(/opening|hours/i);
  });

  it('шапка, подвал и главная не содержат слов про часы работы и метки [ЧАСЫ РАБОТЫ — впиши]', async () => {
    const db = createTestDb();
    db.prepare("INSERT OR REPLACE INTO shop_settings (key, value, updated_at) VALUES ('work_hours', 'Пн-Пт 9-18', 1)").run();
    const shell = loadShellContext({ db });
    const html = [
      renderToStaticMarkup(<SiteHeader shell={shell} />),
      renderToStaticMarkup(<SiteFooter shell={shell} />),
      renderToStaticMarkup(<HomeView data={await getHomeData({ db })} />),
    ].join('\n');
    expect(html).not.toMatch(/часы работы/i);
    expect(html).not.toContain('Пн-Пт 9-18');
  });

  it('страница контактов не обращается к часам работы', () => {
    expect(read('src', 'app', '(shop)', 'contacts', 'page.tsx')).not.toMatch(/hours|ЧАСЫ|Часы работы/);
  });
});

describe('G06: услуга по ремонту техники', () => {
  it('после миграций есть одна опубликованная услуга без цен, сроков и гарантий', () => {
    const db = createTestDb();
    const list = listPublishedServices({ db });
    expect(list).toHaveLength(1);
    const s = list[0]!;
    expect(s.slug).toBe('remont-sadovoj-tehniki');
    expect(s.title).toBe('Ремонт и обслуживание садовой техники');
    expect(s.h1).toBeTruthy();
    expect(s.priceText).toBeNull();
    expect(s.seoTitle).toBe('Ремонт и обслуживание садовой техники'); // «— РемТехСад» добавляет шаблон title, дубль не нужен
    const text = [s.title, s.h1, s.summary, s.body, s.seoDescription].join(' ');
    expect(text).not.toMatch(/₽|руб|гаранти|срок|за \d+|\d+\s*(дн|час|мин)|бесплатн|скидк/i);
    expect(text).not.toMatch(/\[[^\]]+— впиши\]/);
    expect(getPublishedService('remont-sadovoj-tehniki', { db })?.published).toBe(true);
    expect(listPublicUrls({ db }).map((u) => u.path)).toContain('/services/remont-sadovoj-tehniki');
  });

  it('миграция не добавляет услугу, если услуги уже есть, и повторный запуск идемпотентен', () => {
    const db = createTestDb();
    const sql = migration('0950');
    db.exec(sql);
    expect(listPublishedServices({ db })).toHaveLength(1);
    db.exec('DELETE FROM services');
    db.prepare("INSERT INTO services (slug, title, body, published, sort, updated_at) VALUES ('svoya', 'Своя услуга', 'Текст', 1, 0, 5)").run();
    db.exec(sql);
    expect(listPublishedServices({ db }).map((x) => x.slug)).toEqual(['svoya']);
  });
});

describe('G06: правка SEO-заголовка услуги (0954)', () => {
  it('меняет только нетронутую сидовую запись; правка админа остаётся', () => {
    const db = createTestDb();
    const sql = migration('0954');
    db.prepare("UPDATE services SET seo_title = 'Ремонт и обслуживание садовой техники — РемТехСад', updated_at = 0").run();
    db.exec(sql);
    expect(getPublishedService('remont-sadovoj-tehniki', { db })?.seoTitle).toBe('Ремонт и обслуживание садовой техники');
    db.prepare("UPDATE services SET seo_title = 'Мой заголовок', updated_at = 50").run();
    db.exec(sql);
    expect(getPublishedService('remont-sadovoj-tehniki', { db })?.seoTitle).toBe('Мой заголовок');
  });
});

describe('G08: текст «О компании»', () => {
  const FORBIDDEN = /\d{4}\s*год|лет\b|с \d{4}|гаранти|официальн|дилер|отзыв|сотрудник|специалист|опыт|быстр|срок|бесплатн|лучш|№1|скидк/i;

  it('3–5 абзацев с реальными фактами из брифа и без выдуманных обещаний', () => {
    const db = createTestDb();
    const page = getPageByKey('about', { db })!;
    expect(page.body).not.toMatch(/\[[^\]]+— впиши\]/);
    const paragraphs = page.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(paragraphs.length).toBeLessThanOrEqual(5);
    for (const fact of ['подберём новую, починим старую', 'Талдом, Садовый переулок д10', '+7 916-655-06-06', 'заявк']) expect(page.body).toContain(fact);
    for (const word of ['снегоотбрасывател', 'пил', 'триммер', 'генератор']) expect(page.body.toLowerCase()).toContain(word);
    expect(page.body).not.toMatch(FORBIDDEN);
  });

  it('админская правка не затирается, повторный запуск идемпотентен', () => {
    const db = createTestDb();
    const sql = migration('0951');
    db.prepare("UPDATE pages SET body = 'Мой текст', updated_at = 99 WHERE key = 'about'").run();
    db.exec(sql);
    expect(getPageByKey('about', { db })!.body).toBe('Мой текст');
    // страница, где админ вернул метку-заглушку, но уже сохранялась (updated_at > 0), тоже его
    db.prepare("UPDATE pages SET body = '[ТЕКСТ О КОМПАНИИ — впиши]', updated_at = 100 WHERE key = 'about'").run();
    db.exec(sql);
    expect(getPageByKey('about', { db })!.body).toBe('[ТЕКСТ О КОМПАНИИ — впиши]');
    // сидовая страница (метка и updated_at = 0) заполняется
    db.prepare("UPDATE pages SET body = '[ТЕКСТ О КОМПАНИИ — впиши]', updated_at = 0 WHERE key = 'about'").run();
    db.exec(sql);
    const filled = getPageByKey('about', { db })!.body;
    expect(filled).not.toContain('впиши');
    db.exec(sql);
    expect(getPageByKey('about', { db })!.body).toBe(filled);
  });

  it('блок «О компании» на главной показывает текст, а не метку', async () => {
    const db = createTestDb();
    const html = renderToStaticMarkup(<HomeView data={await getHomeData({ db })} />);
    expect(html).not.toContain('ТЕКСТ О КОМПАНИИ');
    expect(html).toContain('починим старую');
  });
});

describe('G09: координаты и карта', () => {
  it('координаты дома Садовый переулок 10 в Талдоме заданы начальной настройкой', () => {
    const db = createTestDb();
    const info = getShopInfo({ db });
    expect(info.latitude).toBeCloseTo(56.7299, 3);
    expect(info.longitude).toBeCloseTo(37.5268, 3);
  });

  it('админские координаты не затираются, повторный запуск идемпотентен', () => {
    const db = createTestDb();
    const sql = migration('0952');
    setSetting('latitude', '55.5', { db, now: 7 });
    setSetting('longitude', '37.1', { db, now: 7 });
    db.exec(sql);
    db.exec(sql);
    expect(getSetting('latitude', { db })).toBe('55.5');
    expect(getSetting('longitude', { db })).toBe('37.1');
  });

  it('главная и блок карты рисуют холст карты, ссылку «Построить маршрут» и подпись с адресом при сбое', async () => {
    const db = createTestDb();
    const html = renderToStaticMarkup(<HomeView data={await getHomeData({ db })} />);
    expect(html).toContain('shop-map__canvas');
    expect(html).toContain('Построить маршрут');
    const info = getShopInfo({ db });
    const map = renderToStaticMarkup(<ShopMap latitude={info.latitude} longitude={info.longitude} address={info.address} />);
    expect(map).toContain('shop-map__canvas');
    expect(read('src', 'ui', 'map', 'ShopMapCanvas.tsx')).toMatch(/tileerror/);
  });
});

describe('G07: логотип без белого фона', () => {
  const load = async (name: string) => {
    const { data, info } = await sharp(join(root, 'public', 'brand', name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
  };

  it('logo.png: прозрачные углы, нет почти белых непрозрачных пикселей', async () => {
    const { data, w, h } = await load('logo.png');
    expect(data[3]).toBe(0);
    expect(data[(w - 1) * 4 + 3]).toBe(0);
    expect(data[((h - 1) * w + w - 1) * 4 + 3]).toBe(0);
    let opaque = 0;
    let whiteish = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 200) {
        opaque++;
        if (data[i]! > 225 && data[i + 1]! > 225 && data[i + 2]! > 225) whiteish++;
      }
    }
    expect(opaque).toBeGreaterThan(5000);
    expect(whiteish).toBe(0);
  });

  it('logo-dark.png: непрозрачные пиксели светлые или зелёные, чёрных нет', async () => {
    const { data } = await load('logo-dark.png');
    let opaque = 0;
    let dark = 0;
    let green = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 200) continue;
      opaque++;
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (Math.max(r, g, b) < 110) dark++;
      if (g > r + 40 && g > b + 20) green++;
    }
    expect(opaque).toBeGreaterThan(5000);
    expect(dark).toBe(0);
    expect(green).toBeGreaterThan(1000);
  });

  it('шапка берёт logo.png, подвал — logo-dark.png, подложка подвала не белая', () => {
    const db = createTestDb();
    const shell = loadShellContext({ db });
    expect(renderToStaticMarkup(<SiteHeader shell={shell} />)).toMatch(/<img[^>]*src="\/brand\/logo\.png"/);
    expect(renderToStaticMarkup(<SiteFooter shell={shell} />)).toMatch(/<img[^>]*src="\/brand\/logo-dark\.png"/);
    const css = read('src', 'ui', 'layout', 'layout.css');
    const block = css.slice(css.indexOf('.site-footer__logo {'), css.indexOf('}', css.indexOf('.site-footer__logo {')));
    expect(block).not.toMatch(/#fff|white/i);
  });
});

describe('G03: фон героя главной', () => {
  it('SVG-иллюстрация оригинальная и самодостаточная, баннер героя использует её с затемнением под текстом', () => {
    const svg = read('public', 'brand', 'hero-garden.svg');
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    expect(svg).not.toMatch(/<image\b|href="https?:|xlink:href="https?:|<script/i);
    const css = read('src', 'ui', 'home', 'home.css');
    const banner = css.slice(css.indexOf('.home-hero__banner {'), css.indexOf('}', css.indexOf('.home-hero__banner {')));
    expect(banner).toContain('/brand/hero-garden.svg');
    expect(banner).toMatch(/linear-gradient\(/);
  });

  it('без слайдов герой — баннер со слоганом и кнопкой; со слайдами остаётся слайдер', async () => {
    const db = createTestDb();
    const html = renderToStaticMarkup(<HomeView data={await getHomeData({ db })} />);
    expect(html).toContain('home-hero__banner');
    expect(html).toContain('подберём новую, починим старую');
  });
});

describe('G05: карточки единого размера и без битых картинок', () => {
  const css = read('src', 'ui', 'catalog', 'catalog.css');
  const homeCss = read('src', 'ui', 'home', 'home.css');
  const rule = (text: string, selector: string) => {
    const i = text.indexOf(`${selector} {`);
    return i < 0 ? '' : text.slice(i, text.indexOf('}', i));
  };

  it('фиксированное соотношение сторон картинки, contain и обрезка названий в 2 строки', () => {
    expect(rule(css, '.category-tile__media')).toMatch(/aspect-ratio:\s*4\s*\/\s*3/);
    expect(rule(css, '.product-image')).toMatch(/aspect-ratio/);
    expect(rule(css, '.product-image img')).toMatch(/object-fit:\s*contain/);
    expect(rule(css, '.product-card__title')).toMatch(/line-clamp:\s*2/);
    const clamp = /line-clamp:\s*2/;
    expect(css + homeCss).toMatch(clamp);
    expect(`${rule(css, '.category-tile__name')}${rule(homeCss, '.category-tile__name')}`).toMatch(clamp);
  });

  it('плитки каталога выводят фото тем же компонентом, что и карточки товара (с запасной иконкой)', () => {
    const tiles = read('src', 'ui', 'catalog', 'CategoryTiles.tsx');
    expect(tiles).toContain('ProductImage');
    expect(tiles).not.toMatch(/<img\b/);
    const image = read('src', 'ui', 'catalog', 'SafeImage.tsx');
    expect(image).toMatch(/^'use client'/);
    expect(image).toContain('onError');
  });
});
