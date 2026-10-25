import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyCanonicalRules,
  DEFAULT_SEO,
  getSeoSettings,
  previewSeoTemplate,
  renderSeoTemplate,
  saveSeoSettings,
  validateSeoTemplate,
  type SeoSettingsInput,
} from '@/domain/content/seo-settings';
import { categoryMetadata, productMetadata, loadCategorySeoContext, loadProductSeoContext } from '@/domain/seo/metadata';
import { buildRobots } from '@/domain/seo/robots';
import { listSitemapEntries } from '@/domain/seo/sitemap';
import { ConflictError, ForbiddenError, ValidationError } from '@/server/http/errors';
import { ADMIN, MANAGER, pngBytes } from '../content/helpers';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';

const SITE = 'https://shop.example.ru';
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const input = (db: ReturnType<typeof createTestDb>, patch: Partial<SeoSettingsInput> = {}): SeoSettingsInput => {
  const s = getSeoSettings({ db });
  return {
    version: s.version,
    siteName: s.siteName,
    description: s.description,
    ogType: s.ogType,
    canonicalHttps: s.canonicalHttps,
    canonicalHost: s.canonicalHost,
    robotsIndex: s.robotsIndex,
    robotsDisallow: s.robotsDisallow.join('\n'),
    sitemapSections: s.sitemapSections,
    changeFrequency: s.changeFrequency ?? '',
    priority: s.priority === null ? '' : String(s.priority),
    templates: s.templates,
    noindexFilters: s.noindexFilters,
    noindexEmptyCategories: s.noindexEmptyCategories,
    ...patch,
  };
};
const save = (db: ReturnType<typeof createTestDb>, patch: Partial<SeoSettingsInput> = {}) => saveSeoSettings(ADMIN, input(db, patch), { db, now: 1000 });

describe('шаблоны SEO', () => {
  it('подставляют переменные и убирают следы пустых значений', () => {
    const vars = { name: 'Триммер', brand: '', category: 'Садовая техника', price: '5 990 ₽', site: 'РемТехСад' };
    expect(renderSeoTemplate('{name} {brand} — купить в {site}', vars)).toBe('Триммер — купить в РемТехСад');
    expect(renderSeoTemplate('{brand} {name} за {price}', { ...vars, brand: 'Husqvarna' })).toBe('Husqvarna Триммер за 5 990 ₽');
    expect(renderSeoTemplate('{name} ({brand})', vars)).toBe('Триммер');
  });

  it('проверка: неизвестная переменная и непарные скобки — ошибка', () => {
    expect(validateSeoTemplate('{name} — {site}', 200)).toBeNull();
    expect(validateSeoTemplate('{nope}', 200)).toMatch(/Неизвестная переменная/);
    expect(validateSeoTemplate('{name', 200)).toMatch(/Скобки/);
    expect(validateSeoTemplate('x'.repeat(201), 200)).toMatch(/длиннее/);
  });

  it('предпросмотр работает на реальном товаре и категории', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    addProduct(db, { name: 'Триммер ABC', slug: 'abc', categoryId: cat, priceRub: 5990 });
    const p = previewSeoTemplate(ADMIN, { kind: 'productTitle', template: '{name} | {category}' }, { db });
    expect(p).toMatchObject({ ok: true, text: 'Триммер ABC | Триммеры' });
    expect(previewSeoTemplate(ADMIN, { kind: 'categoryTitle', template: '{name} в {site}' }, { db })).toMatchObject({ ok: true, text: 'Триммеры в РемТехСад' });
    expect(previewSeoTemplate(ADMIN, { kind: 'productTitle', template: '{bad}' }, { db })).toMatchObject({ ok: false });
  });
});

describe('сохранение SEO-настроек', () => {
  it('нужны права seo.write; менеджер — только просмотр', async () => {
    const db = createTestDb();
    await expect(saveSeoSettings(MANAGER, input(db), { db })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('пишет аудит, поднимает версию и защищает от конфликта', async () => {
    const db = createTestDb();
    const a = input(db);
    const b = input(db);
    await save(db, { ...a, siteName: 'Сад' });
    expect(getSeoSettings({ db }).siteName).toBe('Сад');
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'seo_settings'").get() as { n: number }).n).toBe(1);
    await expect(saveSeoSettings(ADMIN, { ...b, siteName: 'Другой' }, { db })).rejects.toBeInstanceOf(ConflictError);
  });

  it('валидация: путь robots, шаблон, приоритет, частота', async () => {
    const db = createTestDb();
    for (const patch of [{ robotsDisallow: 'no-slash' }, { robotsDisallow: '/' }, { priority: '2' }, { changeFrequency: 'often' }, { templates: { ...DEFAULT_SEO.templates, productTitle: '{x}' } }]) {
      await expect(save(db, patch)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('изображение Open Graph проверяется по содержимому', async () => {
    const db = createTestDb();
    const dir = mkdtempSync(join(tmpdir(), 'rts-og-'));
    dirs.push(dir);
    await expect(saveSeoSettings(ADMIN, { ...input(db), ogImage: { bytes: new TextEncoder().encode('not image') } }, { db, uploadsDir: dir })).rejects.toBeInstanceOf(ValidationError);
    await saveSeoSettings(ADMIN, { ...input(db), ogImage: { bytes: new Uint8Array(await pngBytes(600, 315)) } }, { db, uploadsDir: dir });
    expect(getSeoSettings({ db }).ogImagePath).toMatch(/\.webp$/);
  });
});

describe('влияние на публичные страницы', () => {
  it('robots.txt: индексация выкл → Disallow: /, доп. пути добавляются', async () => {
    const db = createTestDb();
    await save(db, { robotsDisallow: '/internal\n/tmp' });
    const r = buildRobots(SITE, getSeoSettings({ db }));
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule?.disallow).toEqual(expect.arrayContaining(['/admin', '/internal', '/tmp']));
    await save(db, { robotsIndex: false });
    const closed = buildRobots(SITE, getSeoSettings({ db }));
    const closedRule = Array.isArray(closed.rules) ? closed.rules[0] : closed.rules;
    expect(closedRule?.disallow).toBe('/');
    expect(closed.sitemap).toBeUndefined();
  });

  it('sitemap: разделы выключаются, частота и приоритет попадают в записи', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    addProduct(db, { name: 'Триммер', slug: 'trimmer-1', categoryId: cat });
    const urls = () => listSitemapEntries({ db, siteUrl: SITE }).map((e) => e.url);
    expect(urls()).toContain(`${SITE}/product/trimmer-1`);
    await save(db, { sitemapSections: { ...DEFAULT_SEO.sitemapSections, products: false } });
    expect(urls()).not.toContain(`${SITE}/product/trimmer-1`);
    expect(urls()).toContain(`${SITE}/catalog/trimmery`);
    await save(db, { sitemapSections: { ...DEFAULT_SEO.sitemapSections, products: true, categories: false, pages: false }, changeFrequency: 'daily', priority: '0.7' });
    expect(urls()).not.toContain(`${SITE}/catalog/trimmery`);
    expect(urls()).not.toContain(`${SITE}/contacts`);
    const entry = listSitemapEntries({ db, siteUrl: SITE }).find((e) => e.url.endsWith('/product/trimmer-1'));
    expect(entry).toMatchObject({ changeFrequency: 'daily', priority: 0.7 });
  });

  it('карточка товара: шаблон применяется, индивидуальное SEO-поле важнее шаблона', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    const id = addProduct(db, { name: 'Триммер ABC', slug: 'abc', categoryId: cat });
    await save(db, { templates: { ...DEFAULT_SEO.templates, productTitle: '{name} — {category} | {site}', productDescription: 'Купить {name}' }, siteName: 'Мой Сад', ogType: 'article' });
    const ctx = loadProductSeoContext(id, { db });
    const product = { name: 'Триммер ABC', slug: 'abc', descriptionHtml: null, images: [], category: { name: 'Триммеры' } as never, unitKopecks: 0 };
    const meta = productMetadata(product, null, ctx);
    expect(meta.title).toBe('Триммер ABC — Триммеры | Мой Сад');
    expect(meta.description).toBe('Купить Триммер ABC');
    expect(meta.openGraph).toMatchObject({ siteName: 'Мой Сад', type: 'article', url: '/product/abc' });
    expect(meta.alternates?.canonical).toBe('/product/abc');
    const own = productMetadata(product, { seoTitle: 'Свой title', seoDescription: 'Своё описание' }, ctx);
    expect(own.title).toBe('Свой title');
    expect(own.description).toBe('Своё описание');
  });

  it('категория: шаблон, свои поля важнее, фильтры и пустые категории — noindex по правилам', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    const empty = addCategory(db, 'Пустая', 'pustaya');
    addProduct(db, { name: 'Триммер', slug: 't', categoryId: cat });
    await save(db, { templates: { ...DEFAULT_SEO.templates, categoryTitle: '{name} — каталог', categoryDescription: 'Все {category}' } });
    const info = { id: cat, slug: 'trimmery', name: 'Триммеры', h1: null, seoTitle: null, seoDescription: null, seoText: null, parentId: null };
    const ctx = loadCategorySeoContext(cat, { db });
    expect(categoryMetadata(info, {}, ctx)).toMatchObject({ title: 'Триммеры — каталог', description: 'Все Триммеры' });
    expect(categoryMetadata({ ...info, seoTitle: 'Свой' }, {}, ctx).title).toBe('Свой');
    expect(categoryMetadata(info, { sort: 'price_asc' }, ctx).robots).toMatchObject({ index: false });
    await save(db, { noindexFilters: false });
    expect(categoryMetadata(info, { sort: 'price_asc' }, loadCategorySeoContext(cat, { db })).robots).toBeUndefined();
    const emptyInfo = { ...info, id: empty, slug: 'pustaya', name: 'Пустая' };
    expect(categoryMetadata(emptyInfo, {}, loadCategorySeoContext(empty, { db })).robots).toBeUndefined();
    await save(db, { noindexEmptyCategories: true });
    expect(categoryMetadata(emptyInfo, {}, loadCategorySeoContext(empty, { db })).robots).toMatchObject({ index: false });
    expect(categoryMetadata(info, {}, loadCategorySeoContext(cat, { db })).robots).toBeUndefined();
  });

  it('без настроек метаданные ведут себя как раньше', () => {
    const info = { id: 1, slug: 'x', name: 'Икс', h1: null, seoTitle: null, seoDescription: null, seoText: null, parentId: null };
    expect(categoryMetadata(info, {})).toMatchObject({ title: 'Икс' });
    expect(categoryMetadata(info, { sort: 'price_asc' }).robots).toMatchObject({ index: false });
  });

  it('canonical-правила: https и www; локальные адреса не меняются', () => {
    expect(applyCanonicalRules('http://shop.ru', { canonicalHttps: true, canonicalHost: 'www' })).toBe('https://www.shop.ru');
    expect(applyCanonicalRules('https://www.shop.ru', { canonicalHttps: true, canonicalHost: 'bare' })).toBe('https://shop.ru');
    expect(applyCanonicalRules('http://shop.ru', { canonicalHttps: false, canonicalHost: 'any' })).toBe('http://shop.ru');
    expect(applyCanonicalRules('http://localhost:3000', { canonicalHttps: true, canonicalHost: 'www' })).toBe('http://localhost:3000');
  });
});
