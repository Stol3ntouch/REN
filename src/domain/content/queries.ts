import type { CatalogImage } from '@/domain/catalog/types';
import { getDb, type Db } from '@/server/db/connection';
import { bannersRepo, MAX_HERO_BANNERS, type BannerPosition, type BannerRow } from '@/server/db/repositories/banners';
import { companyReviewsRepo, type CompanyReviewRow } from '@/server/db/repositories/company-reviews';
import { newsRepo, type NewsRow } from '@/server/db/repositories/news';
import { newsCategoriesRepo, type NewsCategoryRow } from '@/server/db/repositories/news-categories';
import { pagesRepo, type PageRow } from '@/server/db/repositories/pages';
import { promotionsRepo, type PromotionRow } from '@/server/db/repositories/promotions';
import { serviceCategoriesRepo, type ServiceCategoryRow } from '@/server/db/repositories/service-categories';
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

export type ContentStatus = 'draft' | 'scheduled' | 'published';

/** Статус по двум полям: не опубликована — черновик; опубликована с датой в будущем — запланирована. */
export function contentStatus(p: { published: boolean; publishedAt: number | null }, now: number): ContentStatus {
  if (!p.published) return 'draft';
  return p.publishedAt !== null && p.publishedAt > now ? 'scheduled' : 'published';
}

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = { draft: 'Черновик', scheduled: 'Запланирована', published: 'Опубликована' };

/** Страницу видит посетитель: опубликована, время наступило и не скрыта администратором. */
export function isPageLive(p: Pick<PageRow, 'published' | 'publishedAt' | 'hiddenByAdmin'>, now: number): boolean {
  return !p.hiddenByAdmin && contentStatus(p, now) === 'published';
}

// Публичное чтение страниц: скрытые администратором, черновики и запланированные (время ещё не пришло) не отдаются
// (404, нет в меню, подвале и sitemap). Админка читает pagesRepo напрямую и видит все.
const shownAt = (p: PageRow | null, now: number): PageRow | null => (p && isPageLive(p, now) ? p : null);
const nowOf = (o: Opts): number => o.now ?? Date.now();

export function getPageByKey(key: PageKey, opts: Opts = {}): PageRow | null {
  return shownAt(pagesRepo.findByKey(dbOf(opts), key), nowOf(opts));
}

export function getPageBySlug(slug: string, opts: Opts = {}): PageRow | null {
  return shownAt(pagesRepo.findBySlug(dbOf(opts), slug), nowOf(opts));
}

export function listPages(opts: Opts = {}): PageRow[] {
  const now = nowOf(opts);
  return pagesRepo.list(dbOf(opts)).filter((p) => isPageLive(p, now));
}

// ---------- скрытие разделов целиком ----------

/** Разделы с записями, которые администратор может скрыть целиком (настройка section_hidden_<раздел> в shop_settings). */
export const HIDEABLE_SECTIONS = ['news', 'promotions', 'services'] as const;
export type HideableSection = (typeof HIDEABLE_SECTIONS)[number];

export const sectionSettingKey = (section: HideableSection): string => `section_hidden_${section}`;

export function isSectionHidden(section: HideableSection, opts: Opts = {}): boolean {
  return settingsRepo.get(dbOf(opts), sectionSettingKey(section)) === '1';
}

// ---------- слайды (устаревшая таблица slides: сайт читает баннеры) ----------

/** @deprecated Слайды главной переехали в баннеры (listBanners('home_hero')); таблица slides осталась как история. */
export function listActiveSlides(opts: Opts = {}): WithImage<SlideRow>[] {
  return slidesRepo.list(dbOf(opts), 'active = 1').map((s) => ({ ...s, image: imageView(s, 'large', s.title) }));
}

// ---------- баннеры ----------

export type BannerView = BannerRow & { image: CatalogImage | null; mobileImage: CatalogImage | null };

const bannerView = (b: BannerRow): BannerView => ({
  ...b,
  image: imageView({ imagePath: b.imagePath, imageVariants: b.imageVariants, imageAlt: b.alt }, 'large', b.heading || b.title),
  mobileImage: imageView({ imagePath: b.mobileImagePath, imageVariants: b.mobileImageVariants, imageAlt: b.alt }, 'card', b.heading || b.title),
});

/** Действующие баннеры позиции (статус active и внутри периода) в порядке показа. */
export function listBanners(position: BannerPosition, opts: Opts = {}): BannerView[] {
  return bannersRepo.listLive(dbOf(opts), position, nowOf(opts)).map(bannerView);
}

/**
 * Баннеры страницы категории: сначала привязанные к самой категории, иначе к ближайшему предку (баннер раздела
 * показывается и в подкатегориях). Пусто — баннера нет, блок не рисуется. Используется страницей категории (C06).
 */
export function getCategoryBanners(categoryId: number, opts: Opts = {}): BannerView[] {
  const db = dbOf(opts);
  const now = nowOf(opts);
  const seen = new Set<number>();
  let id: number | null = categoryId;
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const found = bannersRepo.listLiveForCategory(db, id, now);
    if (found.length > 0) return found.map(bannerView);
    id = bannersRepo.parentOf(db, id);
  }
  return [];
}

/** Слайд главной: баннер home_hero в виде, который рисует слайдер. */
export type HeroSlide = {
  id: number;
  title: string;
  subtitle: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  image: CatalogImage | null;
  mobileImage: CatalogImage | null;
};

/** Баннеры позиции home_hero, не больше трёх (ограничение слайдера сохранено). */
export function listHeroSlides(opts: Opts = {}): HeroSlide[] {
  return listBanners('home_hero', opts)
    .slice(0, MAX_HERO_BANNERS)
    .map((b) => ({
      id: b.id,
      title: b.heading || b.title,
      subtitle: b.subheading,
      linkUrl: b.url,
      linkLabel: b.buttonText,
      image: b.image,
      mobileImage: b.mobileImage,
    }));
}

// ---------- новости ----------

const withNewsImage = (n: NewsRow): WithImage<NewsRow> => ({ ...n, image: imageView(n, 'card', n.title) });

/** Опубликованные новости (время публикации наступило), новые сверху; categoryId — фильтр по категории. */
export function listPublishedNews(opts: Opts & { limit?: number; offset?: number; categoryId?: number | null } = {}): WithImage<NewsRow>[] {
  if (isSectionHidden('news', opts)) return [];
  return newsRepo.listLive(dbOf(opts), nowOf(opts), { categoryId: opts.categoryId, limit: opts.limit, offset: opts.offset }).map(withNewsImage);
}

export function countPublishedNews(opts: Opts & { categoryId?: number | null } = {}): number {
  if (isSectionHidden('news', opts)) return 0;
  return newsRepo.countLive(dbOf(opts), nowOf(opts), opts.categoryId);
}

export function getPublishedNews(slug: string, opts: Opts = {}): WithImage<NewsRow> | null {
  if (isSectionHidden('news', opts)) return null;
  const n = newsRepo.findBySlug(dbOf(opts), slug);
  return n && contentStatus(n, nowOf(opts)) === 'published' ? { ...n, image: imageView(n, 'large', n.title) } : null;
}

export type NewsCategoryView = NewsCategoryRow & { count: number };

/** Категории новостей, в которых есть опубликованные новости (для фильтра на /news). */
export function listNewsCategories(opts: Opts = {}): NewsCategoryView[] {
  const db = dbOf(opts);
  const counts = newsCategoriesRepo.counts(db, nowOf(opts));
  return newsCategoriesRepo
    .list(db)
    .map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }))
    .filter((c) => c.count > 0);
}

export function getNewsCategoryBySlug(slug: string, opts: Opts = {}): NewsCategoryRow | null {
  return newsCategoriesRepo.findBySlug(dbOf(opts), slug);
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

export function listPublishedServices(opts: Opts & { categoryId?: number | null } = {}): WithImage<ServiceRow>[] {
  if (isSectionHidden('services', opts)) return [];
  const rows = opts.categoryId ? servicesRepo.list(dbOf(opts), 'published = 1 AND category_id = ?', [opts.categoryId]) : servicesRepo.list(dbOf(opts), 'published = 1');
  return rows.map((s) => ({ ...s, image: imageView(s, 'card', s.title) }));
}

export type ServiceCategoryView = ServiceCategoryRow & { count: number };

/** Категории услуг, в которых есть опубликованные услуги (для фильтра на /services). */
export function listServiceCategories(opts: Opts = {}): ServiceCategoryView[] {
  const db = dbOf(opts);
  const used = new Map<number, number>();
  for (const s of servicesRepo.list(db, 'published = 1 AND category_id IS NOT NULL')) if (s.categoryId !== null) used.set(s.categoryId, (used.get(s.categoryId) ?? 0) + 1);
  return serviceCategoriesRepo
    .list(db)
    .map((c) => ({ ...c, count: used.get(c.id) ?? 0 }))
    .filter((c) => c.count > 0);
}

export function getServiceCategoryBySlug(slug: string, opts: Opts = {}): ServiceCategoryRow | null {
  return serviceCategoriesRepo.findBySlug(dbOf(opts), slug);
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
