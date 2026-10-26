import { visibleProductSql } from '@/server/db/repositories/products';
import { getSeoSettings, type ChangeFrequency, type SeoSection, type SeoSettings } from '@/domain/content/seo-settings';
import { listPublicUrls } from '@/domain/content/urls';
import { getDb, type Db } from '@/server/db/connection';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { absoluteUrl } from './site-url';
import { listPublishedProductStamps } from './store';

export type SitemapEntry = { url: string; lastModified?: Date; changeFrequency?: ChangeFrequency; priority?: number };

/** К какому разделу настроек «Sitemap» относится путь контента. */
export function sitemapSectionOf(path: string): SeoSection {
  if (path === '/news' || path.startsWith('/news/')) return 'news';
  if (path === '/services' || path.startsWith('/services/')) return 'services';
  return 'pages';
}

/** Предел протокола sitemaps.org на один файл. */
export const SITEMAP_LIMIT = 50000;

/**
 * Все публичные URL: страницы контента (T08), каталог, категории с товарами (с учётом подкатегорий) и опубликованные товары.
 * Кабинета, корзины, оформления, поиска и админки здесь нет по построению: источники — только перечисленные выше.
 */
export function listSitemapEntries(opts: { db?: Db; siteUrl: string; now?: number; seo?: SeoSettings }): SitemapEntry[] {
  const db = opts.db ?? getDb();
  const seo = opts.seo ?? getSeoSettings({ db });
  const on = seo.sitemapSections;
  const paths: { path: string; lastModified?: Date }[] = listPublicUrls({ db, now: opts.now }).filter((u) => on[sitemapSectionOf(u.path)]);
  if (on.categories) paths.push({ path: '/catalog' });

  const direct = new Map(
    (db.prepare(`SELECT pc.category_id AS id, COUNT(*) AS n FROM product_categories pc JOIN products p ON p.id = pc.product_id WHERE ${visibleProductSql('p')} GROUP BY pc.category_id`).all() as { id: number; n: number }[]).map((r) => [r.id, r.n]),
  );
  const rows = categoriesRepo.listVisible(db);
  const children = new Map<number, number[]>();
  for (const r of rows) if (r.parentId !== null) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
  const total = (id: number, seen = new Set<number>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (direct.get(id) ?? 0) + (children.get(id) ?? []).reduce((s, c) => s + total(c, seen), 0);
  };
  if (on.categories) for (const c of rows) if (c.indexable && total(c.id) > 0) paths.push({ path: `/catalog/${c.slug}` });

  for (const p of on.products ? listPublishedProductStamps(db) : []) {
    const t = Date.parse(p.updatedAt);
    paths.push({ path: `/product/${p.slug}`, lastModified: Number.isNaN(t) ? undefined : new Date(t) });
  }

  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const p of paths) {
    const url = absoluteUrl(opts.siteUrl, p.path);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, ...(p.lastModified ? { lastModified: p.lastModified } : {}), ...(seo.changeFrequency ? { changeFrequency: seo.changeFrequency } : {}), ...(seo.priority !== null ? { priority: seo.priority } : {}) });
  }
  return out;
}

/** Делит список на файлы не больше size URL (когда товаров станет больше 50 000 — подключить generateSitemaps). */
export function splitSitemap<T>(entries: T[], size: number = SITEMAP_LIMIT): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < entries.length; i += size) parts.push(entries.slice(i, i + size));
  return parts;
}

