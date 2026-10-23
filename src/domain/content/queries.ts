import type { CatalogImage } from '@/domain/catalog/types';
import { getDb, type Db } from '@/server/db/connection';
import { companyReviewsRepo, type CompanyReviewRow } from '@/server/db/repositories/company-reviews';
import { newsRepo, type NewsRow } from '@/server/db/repositories/news';
import { pagesRepo, type PageRow } from '@/server/db/repositories/pages';
import { promotionsRepo, type PromotionRow } from '@/server/db/repositories/promotions';
import { servicesRepo, type ServiceRow } from '@/server/db/repositories/services';
import { slidesRepo, type SlideRow } from '@/server/db/repositories/slides';
import { imageView } from './images';

/** Чтение контента для публичных страниц: только опубликованное и действующее. */
type Opts = { db?: Db; now?: number };
export type WithImage<T> = T & { image: CatalogImage | null };

const dbOf = (o: Opts): Db => o.db ?? getDb();

// ---------- страницы ----------

/** Системные страницы с фиксированным адресом; остальные — /pages/<slug>. */
const FIXED_PATHS: Record<string, string> = { about: '/about', privacy: '/privacy' };
export const PAGE_KEYS = ['about', 'delivery', 'warranty', 'faq', 'terms', 'privacy'] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

export function pagePath(page: Pick<PageRow, 'key' | 'slug'>): string {
  return (page.key && FIXED_PATHS[page.key]) || `/pages/${page.slug}`;
}

export function getPageByKey(key: PageKey, opts: Opts = {}): PageRow | null {
  return pagesRepo.findByKey(dbOf(opts), key);
}

export function getPageBySlug(slug: string, opts: Opts = {}): PageRow | null {
  return pagesRepo.findBySlug(dbOf(opts), slug);
}

export function listPages(opts: Opts = {}): PageRow[] {
  return pagesRepo.list(dbOf(opts));
}

// ---------- слайды ----------

export function listActiveSlides(opts: Opts = {}): WithImage<SlideRow>[] {
  return slidesRepo.list(dbOf(opts), 'active = 1').map((s) => ({ ...s, image: imageView(s, 'large', s.title) }));
}

// ---------- новости ----------

const withNewsImage = (n: NewsRow): WithImage<NewsRow> => ({ ...n, image: imageView(n, 'card', n.title) });

export function listPublishedNews(opts: Opts & { limit?: number; offset?: number } = {}): WithImage<NewsRow>[] {
  const all = newsRepo.list(dbOf(opts), 'published = 1');
  const offset = opts.offset ?? 0;
  return all.slice(offset, opts.limit === undefined ? undefined : offset + opts.limit).map(withNewsImage);
}

export function countPublishedNews(opts: Opts = {}): number {
  return newsRepo.count(dbOf(opts), 'published = 1');
}

export function getPublishedNews(slug: string, opts: Opts = {}): WithImage<NewsRow> | null {
  const n = newsRepo.findBySlug(dbOf(opts), slug);
  return n && n.published ? { ...n, image: imageView(n, 'large', n.title) } : null;
}

// ---------- акции ----------

/** Акция действует, если опубликована и сейчас внутри периода (границы необязательны). */
export function isPromotionActive(p: Pick<PromotionRow, 'published' | 'startsAt' | 'endsAt'>, now: number): boolean {
  return p.published && (p.startsAt === null || p.startsAt <= now) && (p.endsAt === null || p.endsAt >= now);
}

export function listActivePromotions(opts: Opts = {}): WithImage<PromotionRow>[] {
  const now = opts.now ?? Date.now();
  return promotionsRepo
    .list(dbOf(opts), 'published = 1')
    .filter((p) => isPromotionActive(p, now))
    .map((p) => ({ ...p, image: imageView(p, 'card', p.title) }));
}

/** Страница акции открывается и после окончания (помечается завершённой) — ссылки и закладки не ломаются. */
export function getPublishedPromotion(slug: string, opts: Opts = {}): WithImage<PromotionRow> | null {
  const p = promotionsRepo.findBySlug(dbOf(opts), slug);
  return p && p.published ? { ...p, image: imageView(p, 'large', p.title) } : null;
}

// ---------- услуги ----------

export function listPublishedServices(opts: Opts = {}): WithImage<ServiceRow>[] {
  return servicesRepo.list(dbOf(opts), 'published = 1').map((s) => ({ ...s, image: imageView(s, 'card', s.title) }));
}

export function getPublishedService(slug: string, opts: Opts = {}): WithImage<ServiceRow> | null {
  const s = servicesRepo.findBySlug(dbOf(opts), slug);
  return s && s.published ? { ...s, image: imageView(s, 'large', s.title) } : null;
}

// ---------- отзывы о компании ----------

export function listPublishedReviews(opts: Opts & { limit?: number } = {}): CompanyReviewRow[] {
  const all = companyReviewsRepo.list(dbOf(opts), 'published = 1');
  return opts.limit === undefined ? all : all.slice(0, opts.limit);
}

/** То же для «сейчас» (страницы вызывают её, чтобы не читать часы в разметке). */
export function isPromotionActiveNow(p: Pick<PromotionRow, 'published' | 'startsAt' | 'endsAt'>): boolean {
  return isPromotionActive(p, Date.now());
}
