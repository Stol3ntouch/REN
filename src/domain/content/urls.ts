import { getDb, type Db } from '@/server/db/connection';
import { companyReviewsRepo } from '@/server/db/repositories/company-reviews';
import {
  countPublishedNews,
  listActivePromotions,
  listPages,
  listPublishedNews,
  listPublishedServices,
  pagePath,
} from './queries';
import { COMPANY_REVIEWS_PATH } from './shell';

export type PublicUrl = { path: string; lastModified?: Date };

/**
 * Публичные страницы контента для sitemap.xml (T11 добавляет к ним каталог, категории и товары).
 * Только то, что видит посетитель: пустые разделы (новости, акции, отзывы) и черновики не попадают.
 * path — путь с ведущим «/»; домен добавляет T11 из SITE_URL.
 */
export function listPublicUrls(opts: { db?: Db; now?: number } = {}): PublicUrl[] {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const urls: PublicUrl[] = [{ path: '/' }, { path: '/contacts' }, { path: '/buyers' }, { path: '/services' }];

  for (const page of listPages({ db })) urls.push({ path: pagePath(page), lastModified: page.updatedAt > 0 ? new Date(page.updatedAt) : undefined });

  for (const s of listPublishedServices({ db })) urls.push({ path: `/services/${s.slug}`, lastModified: new Date(s.updatedAt) });

  if (countPublishedNews({ db }) > 0) {
    urls.push({ path: '/news' });
    for (const n of listPublishedNews({ db })) urls.push({ path: `/news/${n.slug}`, lastModified: new Date(n.updatedAt) });
  }

  const promotions = listActivePromotions({ db, now });
  if (promotions.length > 0) {
    urls.push({ path: '/promotions' });
    for (const p of promotions) urls.push({ path: `/promotions/${p.slug}`, lastModified: new Date(p.updatedAt) });
  }

  if (companyReviewsRepo.count(db, 'published = 1') > 0) urls.push({ path: COMPANY_REVIEWS_PATH });
  return urls;
}
