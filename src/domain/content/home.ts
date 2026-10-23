import { getCategoryTree } from '@/domain/catalog/categories';
import { getPopularitySql } from '@/domain/catalog/popularity';
import { listCards, categoryScope, type Scope } from '@/domain/catalog/store';
import type { CatalogImage, ProductCard } from '@/domain/catalog/types';
import { cardsByIds } from '@/domain/customers/cards';
import { getDb, type Db } from '@/server/db/connection';
import { homeProductsRepo } from '@/server/db/repositories/home-products';
import type { CompanyReviewRow } from '@/server/db/repositories/company-reviews';
import type { NewsRow } from '@/server/db/repositories/news';
import type { PageRow } from '@/server/db/repositories/pages';
import type { PromotionRow } from '@/server/db/repositories/promotions';
import type { ServiceRow } from '@/server/db/repositories/services';
import type { SlideRow } from '@/server/db/repositories/slides';
import {
  getPageByKey,
  listActivePromotions,
  listActiveSlides,
  listPublishedNews,
  listPublishedReviews,
  listPublishedServices,
  type WithImage,
} from './queries';
import { getSettings, getShopInfo, type ShopInfo } from './settings';

export const HOME_BLOCK_SIZE = 8;
export const HOME_CATEGORIES = 6;
/** «Новинка» — товар, впервые увиденный в каталоге не позже этого числа дней назад. */
export const NEW_PRODUCT_DAYS = 30;

export type HomeCategory = { id: number; slug: string; name: string; productCount: number; image: CatalogImage | null };

export const DEFAULT_HOME_H1 = 'РемТехСад — товары для сада и ремонт техники';

export type HomeData = {
  shop: ShopInfo;
  /** Редактируемые SEO-поля главной (настройки home_h1, home_title, home_description). */
  seo: { h1: string; title: string | null; description: string | null };
  slides: WithImage<SlideRow>[];
  categories: HomeCategory[];
  newProducts: ProductCard[];
  popularProducts: ProductCard[];
  promoProducts: ProductCard[];
  promotions: WithImage<PromotionRow>[];
  services: WithImage<ServiceRow>[];
  reviews: CompanyReviewRow[];
  news: WithImage<NewsRow>[];
  about: PageRow | null;
};

type Opts = { db?: Db; now?: Date };

/** Фото категории — фото самого «верхнего» товара внутри неё (своих картинок у категорий в YML нет). */
function categoryImage(db: Db, slug: string): CatalogImage | null {
  const scope = categoryScope(db, slug);
  if (!scope) return null;
  const s: Scope = { categoryIds: scope.ids, match: null, filters: {} };
  return listCards(db, s, 'name', 1, 0)[0]?.image ?? null;
}

/**
 * Данные главной. Пустые блоки — пустые массивы (страница их не рисует). Ничего не выдумывается:
 *  - новые — товары, впервые увиденные за NEW_PRODUCT_DAYS дней, но не весь каталог сразу (первая загрузка ≠ «новинки»);
 *  - популярные — избранные админом (products.featured), иначе самые продаваемые; нет ни тех ни других — блока нет;
 *  - акционные — только с реальной скидочной ценой (discount < price).
 */
export async function getHomeData(opts: Opts = {}): Promise<HomeData> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  const tree = await getCategoryTree({ db });
  const categories = tree
    .filter((c) => c.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name, 'ru'))
    .slice(0, HOME_CATEGORIES)
    .map((c) => ({ id: c.id, slug: c.slug, name: c.name, productCount: c.productCount, image: categoryImage(db, c.slug) }));

  const sinceIso = new Date(nowMs - NEW_PRODUCT_DAYS * 86_400_000).toISOString();
  const published = homeProductsRepo.countPublished(db);
  const newCount = homeProductsRepo.countNewSince(db, sinceIso);
  const newIds = newCount > 0 && newCount < published ? homeProductsRepo.newIds(db, sinceIso, HOME_BLOCK_SIZE) : [];

  let popularIds = homeProductsRepo.featuredIds(db, HOME_BLOCK_SIZE);
  if (popularIds.length === 0) {
    const sql = getPopularitySql(db);
    if (sql) popularIds = homeProductsRepo.topSoldIds(db, sql, HOME_BLOCK_SIZE);
  }

  const settings = getSettings({ db });
  return {
    shop: getShopInfo({ db }),
    seo: {
      h1: settings.home_h1?.trim() || DEFAULT_HOME_H1,
      title: settings.home_title?.trim() || null,
      description: settings.home_description?.trim() || null,
    },
    slides: listActiveSlides({ db }),
    categories,
    newProducts: cardsByIds(db, newIds),
    popularProducts: cardsByIds(db, popularIds),
    promoProducts: cardsByIds(db, homeProductsRepo.discountedIds(db, HOME_BLOCK_SIZE)),
    promotions: listActivePromotions({ db, now: nowMs }),
    services: listPublishedServices({ db }),
    reviews: listPublishedReviews({ db, limit: 3 }),
    news: listPublishedNews({ db, limit: 3 }),
    about: getPageByKey('about', { db }),
  };
}
