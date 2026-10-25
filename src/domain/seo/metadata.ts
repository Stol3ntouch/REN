import type { Metadata } from 'next';
import { parseCatalogParams, type RawParams } from '@/domain/catalog/params';
import type { CatalogImage, CategoryInfo, ProductPage } from '@/domain/catalog/types';
import { contentMetadata, plainExcerpt } from '@/domain/content/seo';
import {
  categoryTemplateVars,
  DEFAULT_SEO,
  effectiveSiteName,
  getSeoSettings,
  ogImageUrl,
  productTemplateVars,
  renderSeoTemplate,
  type SeoSettings,
} from '@/domain/content/seo-settings';
import { getDb, type Db } from '@/server/db/connection';
import { seoSettingsRepo } from '@/server/db/repositories/seo-settings';
import type { ProductSeo } from './store';

/** Метаданные закрытых страниц (кабинет, корзина, оформление, поиск…). */
export const NOINDEX = { index: false, follow: false } as const;

/**
 * Что нужно метаданным от настроек «SEO и метаданные»: шаблоны, правила индексации, название сайта, бренд товара,
 * число товаров категории. Без контекста действуют значения по умолчанию (поведение до появления настроек).
 */
export type SeoContext = {
  settings: SeoSettings;
  siteName: string;
  brand?: string | null;
  /** Видимые товары категории (с подкатегориями) — для правила «пустые категории — noindex». */
  categoryTotal?: number;
};

const DEFAULT_CONTEXT: SeoContext = { settings: DEFAULT_SEO, siteName: 'РемТехСад' };

function baseContext(opts: { db?: Db }): { settings: SeoSettings; siteName: string; db: Db } {
  const db = opts.db ?? getDb();
  const settings = getSeoSettings({ db });
  return { settings, siteName: effectiveSiteName(settings, { db }), db };
}

/** Контекст страницы товара из БД; любой сбой — без настроек (страница не должна падать из-за SEO). */
export function loadProductSeoContext(productId: number, opts: { db?: Db } = {}): SeoContext {
  try {
    const { settings, siteName, db } = baseContext(opts);
    return { settings, siteName, brand: seoSettingsRepo.brandOfProduct(db, productId) };
  } catch {
    return DEFAULT_CONTEXT;
  }
}

/** Контекст страницы категории; число товаров считается только если включено правило про пустые категории. */
export function loadCategorySeoContext(categoryId: number, opts: { db?: Db } = {}): SeoContext {
  try {
    const { settings, siteName, db } = baseContext(opts);
    return { settings, siteName, categoryTotal: settings.noindexEmptyCategories ? seoSettingsRepo.countVisibleInCategory(db, categoryId) : undefined };
  } catch {
    return DEFAULT_CONTEXT;
  }
}

/** Фильтры, сортировка, цена, наличие и текстовый поиск — дубли категории: в индекс не нужны. */
export function isFilteredCatalog(raw: RawParams): boolean {
  const q = parseCatalogParams(raw);
  return Object.keys(q.filters).length > 0 || q.text !== undefined || q.priceMin !== undefined || q.priceMax !== undefined || q.inStockOnly === true || q.sort !== 'name';
}

const defaultOgImage = (ctx: SeoContext): CatalogImage | null => {
  const src = ogImageUrl(ctx.settings);
  return src ? { src, alt: ctx.siteName, remote: false } : null;
};

/**
 * Категория: чистый адрес и ?page=N индексируются, у каждой страницы свой canonical;
 * с фильтрами/сортировкой — noindex и canonical на чистый адрес категории (правило отключается в настройках).
 * Тексты: индивидуальные SEO-поля категории → шаблон из настроек → название.
 */
export function categoryMetadata(category: CategoryInfo, raw: RawParams, ctx: SeoContext = DEFAULT_CONTEXT): Metadata {
  const base = `/catalog/${category.slug}`;
  const filtered = isFilteredCatalog(raw);
  const page = filtered ? 1 : parseCatalogParams(raw).page;
  const path = page > 1 ? `${base}?page=${page}` : base;
  const vars = categoryTemplateVars(category, ctx.siteName);
  const t = ctx.settings.templates;
  const title = category.seoTitle?.trim() || (t.categoryTitle ? renderSeoTemplate(t.categoryTitle, vars) : '') || category.name;
  const description = category.seoDescription?.trim() || (t.categoryDescription ? renderSeoTemplate(t.categoryDescription, vars) : '') || null;
  const meta = contentMetadata({
    title: page > 1 ? `${title} — страница ${page}` : title,
    seoDescription: description,
    path,
    siteName: ctx.siteName,
    type: ctx.settings.ogType,
    image: defaultOgImage(ctx),
  });
  const emptyNoindex = ctx.settings.noindexEmptyCategories && ctx.categoryTotal === 0;
  if (emptyNoindex) return { ...meta, robots: { index: false, follow: true } };
  return filtered && ctx.settings.noindexFilters ? { ...meta, robots: { index: false, follow: true } } : meta;
}

/**
 * Товар: ручные SEO-поля (product_seo) → шаблон из настроек → название и начало описания;
 * canonical, Open Graph с первым фото (нет фото — изображение по умолчанию из настроек).
 */
export function productMetadata(product: Pick<ProductPage, 'name' | 'slug' | 'descriptionHtml' | 'images'> & Partial<Pick<ProductPage, 'category' | 'unitKopecks'>>, seo: ProductSeo | null, ctx: SeoContext = DEFAULT_CONTEXT): Metadata {
  const excerpt = plainExcerpt(product.descriptionHtml?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '), 160);
  const vars = productTemplateVars({ name: product.name, brand: ctx.brand ?? null, category: product.category?.name ?? '', unitKopecks: product.unitKopecks ?? 0 }, ctx.siteName);
  const t = ctx.settings.templates;
  const fromTitle = t.productTitle ? renderSeoTemplate(t.productTitle, vars) : '';
  const fromDescription = t.productDescription ? renderSeoTemplate(t.productDescription, vars) : '';
  return contentMetadata({
    title: product.name,
    seoTitle: seo?.seoTitle?.trim() || fromTitle || null,
    seoDescription: seo?.seoDescription?.trim() || fromDescription || null,
    fallbackDescription: excerpt,
    path: `/product/${product.slug}`,
    ...(seo?.canonicalUrl ? { canonical: seo.canonicalUrl } : {}),
    ...(seo?.indexable === false ? { noindex: true } : {}),
    image: product.images[0] ?? defaultOgImage(ctx),
    siteName: ctx.siteName,
    type: ctx.settings.ogType,
  });
}
