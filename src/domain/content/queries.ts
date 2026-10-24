import type { CatalogImage } from '@/domain/catalog/types';
import { getDb, type Db } from '@/server/db/connection';
import { companyReviewsRepo, type CompanyReviewRow } from '@/server/db/repositories/company-reviews';
import { newsRepo, type NewsRow } from '@/server/db/repositories/news';
import { pagesRepo, type PageRow } from '@/server/db/repositories/pages';
import { promotionsRepo, type PromotionRow } from '@/server/db/repositories/promotions';
import { servicesRepo, type ServiceRow } from '@/server/db/repositories/services';
import { settingsRepo } from '@/server/db/repositories/settings';
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

/**
 * Страницы, которые скрыть нельзя: на них ссылаются формы (согласие на обработку персональных данных).
 * Проверяет сервер (contentOps.pages.setHidden); в админке кнопка неактивна.
 */
export const UNHIDEABLE_PAGE_KEYS: readonly string[] = ['privacy'];

export function isPageHideLocked(page: Pick<PageRow, 'key'>): boolean {
  return page.key !== null && UNHIDEABLE_PAGE_KEYS.includes(page.key);
}

// Публичное чтение страниц: скрытые администратором не отдаются (404, нет в меню, подвале и sitemap).
// Админка читает pagesRepo напрямую и видит все.
const shown = (p: PageRow | null): PageRow | null => (p && !p.hiddenByAdmin ? p : null);

export function getPageByKey(key: PageKey, opts: Opts = {}): PageRow | null {
  return shown(pagesRepo.findByKey(dbOf(opts), key));
}

export function getPageBySlug(slug: string, opts: Opts = {}): PageRow | null {
  return shown(pagesRepo.findBySlug(dbOf(opts), slug));
}

export function listPages(opts: Opts = {}): PageRow[] {
  return pagesRepo.list(dbOf(opts)).filter((p) => !p.hiddenByAdmin);
}

// ---------- скрытие разделов целиком ----------

/** Разделы с записями, которые администратор может скрыть целиком (настройка section_hidden_<раздел> в shop_settings). */
export const HIDEABLE_SECTIONS = ['news', 'promotions', 'services'] as const;
export type HideableSection = (typeof HIDEABLE_SECTIONS)[number];

export const sectionSettingKey = (section: HideableSection): string => `section_hidden_${section}`;

export function isSectionHidden(section: HideableSection, opts: Opts = {}): boolean {
  return settingsRepo.get(dbOf(opts), sectionSettingKey(section)) === '1';
}

// ---------- слайды ----------

export function listActiveSlides(opts: Opts = {}): WithImage<SlideRow>[] {
  return slidesRepo.list(dbOf(opts), 'active = 1').map((s) => ({ ...s, image: imageView(s, 'large', s.title) }));
}

// ---------- новости ----------

const withNewsImage = (n: NewsRow): WithImage<NewsRow> => ({ ...n, image: imageView(n, 'card', n.title) });

export function listPublishedNews(opts: Opts & { limit?: number; offset?: number } = {}): WithImage<NewsRow>[] {
  if (isSectionHidden('news', opts)) return [];
  const all = newsRepo.list(dbOf(opts), 'published = 1');
  const offset = opts.offset ?? 0;
  return all.slice(offset, opts.limit === undefined ? undefined : offset + opts.limit).map(withNewsImage);
}

export function countPublishedNews(opts: Opts = {}): number {
  if (isSectionHidden('news', opts)) return 0;
  return newsRepo.count(dbOf(opts), 'published = 1');
}

export function getPublishedNews(slug: string, opts: Opts = {}): WithImage<NewsRow> | null {
  if (isSectionHidden('news', opts)) return null;
  const n = newsRepo.findBySlug(dbOf(opts), slug);
  return n && n.published ? { ...n, image: imageView(n, 'large', n.title) } : null;
}

// ---------- акции ----------

/** Акция действует, если опубликована и сейчас внутри периода (границы необязательны). */
export function isPromotionActive(p: Pick<PromotionRow, 'published' | 'startsAt' | 'endsAt'>, now: number): boolean {
  return p.published && (p.startsAt === null || p.startsAt <= now) && (p.endsAt === null || p.endsAt >= now);
}

export function listActivePromotions(opts: Opts = {}): WithImage<PromotionRow>[] {
  if (isSectionHidden('promotions', opts)) return [];
  const now = opts.now ?? Date.now();
  return promotionsRepo
    .list(dbOf(opts), 'published = 1')
    .filter((p) => isPromotionActive(p, now))
    .map((p) => ({ ...p, image: imageView(p, 'card', p.title) }));
}

/** Страница акции открывается и после окончания (помечается завершённой) — ссылки и закладки не ломаются. */
export function getPublishedPromotion(slug: string, opts: Opts = {}): WithImage<PromotionRow> | null {
  if (isSectionHidden('promotions', opts)) return null;
  const p = promotionsRepo.findBySlug(dbOf(opts), slug);
  return p && p.published ? { ...p, image: imageView(p, 'large', p.title) } : null;
}

// ---------- услуги ----------

export function listPublishedServices(opts: Opts = {}): WithImage<ServiceRow>[] {
  if (isSectionHidden('services', opts)) return [];
  return servicesRepo.list(dbOf(opts), 'published = 1').map((s) => ({ ...s, image: imageView(s, 'card', s.title) }));
}

export function getPublishedService(slug: string, opts: Opts = {}): WithImage<ServiceRow> | null {
  if (isSectionHidden('services', opts)) return null;
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
