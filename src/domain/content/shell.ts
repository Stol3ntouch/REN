import { getDb, type Db } from '@/server/db/connection';
import { companyReviewsRepo } from '@/server/db/repositories/company-reviews';
import { newsRepo } from '@/server/db/repositories/news';
import { promotionsRepo } from '@/server/db/repositories/promotions';
import { listCategoryRows } from '@/domain/catalog/category-rows';
import { MAIN_NAV } from '@/ui/nav';
import type { ShellContext, ShellLink } from '@/ui/shell-context';
import { getPageByKey, isPromotionActive, pagePath, type PageKey } from './queries';
import { getShopInfo } from './settings';

/** Адрес страницы отзывов о компании. */
export const COMPANY_REVIEWS_PATH = '/about/reviews';

type Opts = { db?: Db; now?: number };

/**
 * Данные для шапки и подвала из настроек и контента. Пустые разделы не попадают в меню:
 * «Новости» — пока нет опубликованных новостей, «Акции» — пока нет действующих.
 */
export function loadShellContext(opts: Opts = {}): ShellContext {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const shop = getShopInfo({ db });
  const hasNews = newsRepo.count(db, 'published = 1') > 0;
  const hasPromotions = promotionsRepo.list(db, 'published = 1').some((p) => isPromotionActive(p, now));
  const hasReviews = companyReviewsRepo.count(db, 'published = 1') > 0;

  const nav = MAIN_NAV.filter((i) => (i.href === '/news' ? hasNews : i.href === '/promotions' ? hasPromotions : true));
  const pageLink = (key: PageKey): ShellLink[] => {
    const page = getPageByKey(key, { db });
    return page ? [{ href: pagePath(page), label: page.title }] : [];
  };

  return {
    siteName: shop.siteName,
    address: shop.address ?? undefined,
    phone: shop.phone ?? undefined,
    phoneHref: shop.phoneHref ?? undefined,
    logoUrl: shop.logoUrl,
    hours: shop.hours ?? undefined,
    email: shop.email ?? undefined,
    requisites: shop.requisites ?? undefined,
    socials: shop.socials.map((s) => ({ href: s.href, label: s.label })),
    nav,
    catalogLinks: listCategoryRows(db)
      .filter((c) => c.parentId === null)
      .slice(0, 6)
      .map((c) => ({ href: `/catalog/${c.slug}`, label: c.name })),
    buyerLinks: [
      ...pageLink('delivery'),
      ...pageLink('warranty'),
      { href: '/services', label: 'Услуги' },
      ...(hasPromotions ? [{ href: '/promotions', label: 'Акции' }] : []),
      { href: '/contacts', label: 'Контакты' },
    ],
    companyLinks: [
      ...pageLink('about'),
      ...(hasNews ? [{ href: '/news', label: 'Новости' }] : []),
      ...(hasReviews ? [{ href: COMPANY_REVIEWS_PATH, label: 'Отзывы о компании' }] : []),
      ...pageLink('privacy'),
    ],
  };
}
