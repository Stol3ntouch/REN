import type { Metadata } from 'next';
import { parseCatalogParams, type RawParams } from '@/domain/catalog/params';
import type { CategoryInfo, ProductPage } from '@/domain/catalog/types';
import { contentMetadata, plainExcerpt } from '@/domain/content/seo';
import type { ProductSeo } from './store';

/** Метаданные закрытых страниц (кабинет, корзина, оформление, поиск…). */
export const NOINDEX = { index: false, follow: false } as const;

/** Фильтры, сортировка, цена, наличие и текстовый поиск — дубли категории: в индекс не нужны. */
export function isFilteredCatalog(raw: RawParams): boolean {
  const q = parseCatalogParams(raw);
  return Object.keys(q.filters).length > 0 || q.text !== undefined || q.priceMin !== undefined || q.priceMax !== undefined || q.inStockOnly === true || q.sort !== 'name';
}

/**
 * Категория: чистый адрес и ?page=N индексируются, у каждой страницы свой canonical;
 * с фильтрами/сортировкой — noindex и canonical на чистый адрес категории.
 */
export function categoryMetadata(category: CategoryInfo, raw: RawParams): Metadata {
  const base = `/catalog/${category.slug}`;
  const filtered = isFilteredCatalog(raw);
  const page = filtered ? 1 : parseCatalogParams(raw).page;
  const path = page > 1 ? `${base}?page=${page}` : base;
  const title = category.seoTitle?.trim() || category.name;
  const meta = contentMetadata({ title: page > 1 ? `${title} — страница ${page}` : title, seoDescription: category.seoDescription, path });
  return filtered ? { ...meta, robots: { index: false, follow: true } } : meta;
}

/** Товар: ручные SEO-поля (product_seo), иначе название и начало описания; canonical, Open Graph с первым фото. */
export function productMetadata(product: Pick<ProductPage, 'name' | 'slug' | 'descriptionHtml' | 'images'>, seo: ProductSeo | null): Metadata {
  const description = plainExcerpt(product.descriptionHtml?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '), 160);
  return contentMetadata({
    title: product.name,
    seoTitle: seo?.seoTitle,
    seoDescription: seo?.seoDescription,
    fallbackDescription: description,
    path: `/product/${product.slug}`,
    image: product.images[0] ?? null,
  });
}
