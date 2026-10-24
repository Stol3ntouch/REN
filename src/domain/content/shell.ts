import { getDb, type Db } from '@/server/db/connection';
import { companyReviewsRepo } from '@/server/db/repositories/company-reviews';
import { listCategoryRows } from '@/domain/catalog/category-rows';
import { MAIN_NAV } from '@/ui/nav';
import type { ShellContext, ShellLink } from '@/ui/shell-context';
import { countPublishedNews, getPageByKey, listActivePromotions, listBanners, listPublishedServices, pagePath, type PageKey } from './queries';
import { DEFAULT_LOGO_DARK_URL, DEFAULT_LOGO_URL, getShopInfo } from './settings';

/** Адрес страницы отзывов о компании. */
export const COMPANY_REVIEWS_PATH = '/about/reviews';

type Opts = { db?: Db; now?: number };

/**
 * Данные для шапки и подвала из настроек и контента. Пустые и скрытые администратором разделы не попадают в меню:
 * «Новости» — пока нет опубликованных новостей, «Акции» — пока нет действующих, «Услуги» — пока нет опубликованных;
 * скрытая страница («О компании», доставка, гарантия…) пропадает вместе со ссылкой на неё.
 */
export function loadShellContext(opts: Opts = {}): ShellContext {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const shop = getShopInfo({ db });
  const hasNews = countPublishedNews({ db, now }) > 0;
  const hasPromotions = listActivePromotions({ db, now }).length > 0;
  const hasServices = listPublishedServices({ db }).length > 0;
  const hasAbout = getPageByKey('about', { db, now }) !== null;
  const hasReviews = companyReviewsRepo.count(db, 'published = 1') > 0;

  const sectionShown: Record<string, boolean> = { '/news': hasNews, '/promotions': hasPromotions, '/services': hasServices, '/about': hasAbout };
  const nav = MAIN_NAV.filter((i) => sectionShown[i.href] ?? true);
  const pageLink = (key: PageKey): ShellLink[] => {
    const page = getPageByKey(key, { db, now });
    return page ? [{ href: pagePath(page), label: page.title }] : [];
  };

  const strip = listBanners('top_strip', { db, now })[0];
  return {
    siteName: shop.siteName,
    topStrip: strip && strip.heading ? { text: strip.heading, href: strip.url ?? undefined } : undefined,
    address: shop.address ?? undefined,
    phone: shop.phone ?? undefined,
    phoneHref: shop.phoneHref ?? undefined,
    logoUrl: shop.logoUrl,
    logoDarkUrl: shop.logoUrl === DEFAULT_LOGO_URL ? DEFAULT_LOGO_DARK_URL : undefined,
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
      ...(hasServices ? [{ href: '/services', label: 'Услуги' }] : []),
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
