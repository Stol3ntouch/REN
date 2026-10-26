import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { categoryOps } from '@/app/admin/(panel)/_lib/category-ops';
import { categoryBulkOps } from '@/app/admin/(panel)/_lib/category-tree-ops';
import { clearCategoryImageCache, getCategoryImage } from '@/domain/catalog/category-images';
import { getCategoryBySlug, getCategoryTree } from '@/domain/catalog';
import { toCategoryInfo } from '@/domain/catalog/categories';
import { getCategoryBanners } from '@/domain/content/queries';
import { getHomeData } from '@/domain/content/home';
import { loadShellContext } from '@/domain/content/shell';
import { categoryMetadata } from '@/domain/seo/metadata';
import { listSitemapEntries } from '@/domain/seo/sitemap';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { categoryLinksRepo } from '@/server/db/repositories/category-links';
import type { Db } from '@/server/db/connection';
import { CategoryRelated } from '@/ui/catalog/CategoryRelated';
import { admin, T0 } from '../admin/helpers';
import { addCategory, addProduct, createTestDb } from './helpers';

const SITE = 'https://shop.example.ru';
const extra = (over: Record<string, unknown> = {}) => ({ showInMenu: true, showOnHome: true, showInCatalog: true, sort: 1, priority: 0, code: '', externalRef: '', adminComment: '', relatedIds: [] as number[], ...over });

function shop() {
  const db = createTestDb();
  const a = addCategory(db, 'Триммеры', 'trimmery');
  const b = addCategory(db, 'Насосы', 'nasosy');
  const c = addCategory(db, 'Бензиновые', 'benzo', a);
  addProduct(db, { name: 'Т1', categoryId: a });
  addProduct(db, { name: 'Н1', categoryId: b });
  addProduct(db, { name: 'Б1', categoryId: c });
  return { db, a, b, c };
}
const set = (db: Db, id: number, over: Record<string, unknown>) => {
  const cur = categoriesRepo.findById(db, id)!;
  categoryOps.updateExtra(admin, id, extra({ showInMenu: cur.showInMenu, showOnHome: cur.showOnHome, showInCatalog: cur.showInCatalog, sort: cur.sort, priority: cur.priority, code: cur.code ?? '', ...over }), { db, now: T0 });
};

describe('витрина учитывает флаги категорий', () => {
  it('меню и подвал — только show_in_menu; остальные флаги не влияют', () => {
    const { db, a, b } = shop();
    const links = () => (loadShellContext({ db, now: T0 }).catalogLinks ?? []).map((l) => l.href);
    expect(links()).toEqual(['/catalog/trimmery', '/catalog/nasosy']);
    set(db, a, { showInMenu: false });
    expect(links()).toEqual(['/catalog/nasosy']);
    set(db, a, { showInMenu: true, showOnHome: false, showInCatalog: false });
    expect(links()).toEqual(['/catalog/trimmery', '/catalog/nasosy']);
    expect(b).toBeGreaterThan(0);
  });

  it('плитки главной — только show_on_home, порядок — приоритет и позиция', async () => {
    const { db, a, b } = shop();
    expect((await getHomeData({ db, now: new Date(T0) })).categories.map((c) => c.slug)).toEqual(['trimmery', 'nasosy']);
    set(db, b, { priority: -5 });
    expect((await getHomeData({ db, now: new Date(T0) })).categories.map((c) => c.slug)).toEqual(['nasosy', 'trimmery']);
    set(db, a, { showOnHome: false, showInCatalog: false });
    expect((await getHomeData({ db, now: new Date(T0) })).categories.map((c) => c.slug)).toEqual(['nasosy']);
  });

  it('дерево каталога — только show_in_catalog; страница категории при этом открывается; счётчики родителя полные', async () => {
    const { db, a, c } = shop();
    set(db, c, { showInCatalog: false });
    const tree = await getCategoryTree({ db });
    expect(tree.find((n) => n.id === a)).toMatchObject({ children: [], productCount: 2 });
    expect(await getCategoryBySlug('benzo', { db })).not.toBeNull();
  });

  it('неактивная и скрытая категории: 404 на прямом адресе, подкатегории тоже, в sitemap их нет; товары целы', async () => {
    const { db, a } = shop();
    await categoryOps.updateHeader(admin, a, { name: 'Триммеры', slug: 'trimmery', description: '', active: false, sort: 1, parentId: null }, undefined, { db, now: T0 });
    expect(await getCategoryBySlug('trimmery', { db })).toBeNull();
    expect(await getCategoryBySlug('benzo', { db })).toBeNull();
    expect(listSitemapEntries({ db, siteUrl: SITE }).map((e) => e.url)).not.toContain(`${SITE}/catalog/benzo`);
    expect(db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 3 });
  });

  it('массовое скрытие: прямые адреса выбранных и их потомков дают 404, остальные открываются', async () => {
    const { db, a, b } = shop();
    categoryBulkOps.run(admin, [a], { type: 'hide' }, { db, now: T0 });
    expect(await getCategoryBySlug('trimmery', { db })).toBeNull();
    expect(await getCategoryBySlug('benzo', { db })).toBeNull();
    expect(await getCategoryBySlug('nasosy', { db })).not.toBeNull();
    expect(b).toBeGreaterThan(0);
  });

  it('canonical и indexable попадают в метаданные и sitemap', () => {
    const { db, a } = shop();
    categoryOps.updateSeo(admin, a, { seoTitle: '', seoDescription: '', h1: '', seoText: '', slug: '', canonical: 'https://shop.example.ru/catalog/main', indexable: true }, { db, now: T0 });
    const info = toCategoryInfo(categoriesRepo.findById(db, a)!);
    expect(categoryMetadata(info, {}).alternates?.canonical).toBe('https://shop.example.ru/catalog/main');
    categoryOps.updateSeo(admin, a, { seoTitle: '', seoDescription: '', h1: '', seoText: '', slug: '', canonical: '', indexable: false }, { db, now: T0 });
    const off = toCategoryInfo(categoriesRepo.findById(db, a)!);
    expect(categoryMetadata(off, {}).robots).toMatchObject({ index: false });
    expect(categoryMetadata(off, {}).alternates?.canonical).toBe('/catalog/trimmery');
    expect(listSitemapEntries({ db, siteUrl: SITE }).map((e) => e.url)).not.toContain(`${SITE}/catalog/trimmery`);
    expect(listSitemapEntries({ db, siteUrl: SITE }).map((e) => e.url)).toContain(`${SITE}/catalog/nasosy`);
  });

  it('«Смотрите также»: блок только при видимых связях; скрытая связанная не показывается', () => {
    const { db, a, b } = shop();
    expect(renderToStaticMarkup(<CategoryRelated items={categoryLinksRepo.listRelatedVisible(db, a)} />)).toBe('');
    set(db, a, { relatedIds: [b] });
    const html = renderToStaticMarkup(<CategoryRelated items={categoryLinksRepo.listRelatedVisible(db, a)} />);
    expect(html).toContain('Смотрите также');
    expect(html).toContain('href="/catalog/nasosy"');
    categoriesRepo.setHiddenByAdmin(db, b, true);
    categoriesRepo.recomputeEffectiveHidden(db);
    expect(renderToStaticMarkup(<CategoryRelated items={categoryLinksRepo.listRelatedVisible(db, a)} />)).toBe('');
  });

  it('баннер категории: привязанный и включённый показывается на странице категории и подкатегорий; выключенная связь — нет', () => {
    const { db, a, c } = shop();
    const banner = Number(db.prepare("INSERT INTO banners (title, position, status, created_at, updated_at) VALUES ('Скидки', 'category', 'active', 0, 0)").run().lastInsertRowid);
    categoryOps.addBanner(admin, a, banner, { db, now: T0 });
    expect(getCategoryBanners(a, { db, now: T0 }).map((x) => x.id)).toEqual([banner]);
    expect(getCategoryBanners(c, { db, now: T0 }).map((x) => x.id)).toEqual([banner]);
    categoryOps.updateBanner(admin, a, banner, { enabled: false }, { db, now: T0 });
    expect(getCategoryBanners(a, { db, now: T0 })).toEqual([]);
  });

  it('собственное изображение категории главнее фото товара', () => {
    const { db, a } = shop();
    db.prepare("UPDATE products SET published = 1").run();
    clearCategoryImageCache();
    db.prepare("UPDATE categories SET image_path = 'cat/own.webp', image_variants = '[]' WHERE id = ?").run(a);
    clearCategoryImageCache();
    expect(getCategoryImage(a, { db })?.src).toContain('cat/own.webp');
  });
});
