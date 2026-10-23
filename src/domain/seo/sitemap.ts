import { visibleProductSql } from '@/server/db/repositories/products';
import { listPublicUrls } from '@/domain/content/urls';
import { getDb, type Db } from '@/server/db/connection';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { absoluteUrl } from './site-url';
import { listPublishedProductStamps } from './store';

export type SitemapEntry = { url: string; lastModified?: Date };

/** Предел протокола sitemaps.org на один файл. */
export const SITEMAP_LIMIT = 50000;

/**
 * Все публичные URL: страницы контента (T08), каталог, категории с товарами (с учётом подкатегорий) и опубликованные товары.
 * Кабинета, корзины, оформления, поиска и админки здесь нет по построению: источники — только перечисленные выше.
 */
export function listSitemapEntries(opts: { db?: Db; siteUrl: string; now?: number }): SitemapEntry[] {
  const db = opts.db ?? getDb();
  const paths: { path: string; lastModified?: Date }[] = [...listPublicUrls({ db, now: opts.now })];
  paths.push({ path: '/catalog' });

  const direct = new Map(
    (db.prepare(`SELECT p.category_id AS id, COUNT(*) AS n FROM products p WHERE ${visibleProductSql('p')} GROUP BY p.category_id`).all() as { id: number; n: number }[]).map((r) => [r.id, r.n]),
  );
  const rows = categoriesRepo.listAll(db);
  const children = new Map<number, number[]>();
  for (const r of rows) if (r.parentId !== null) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
  const total = (id: number, seen = new Set<number>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (direct.get(id) ?? 0) + (children.get(id) ?? []).reduce((s, c) => s + total(c, seen), 0);
  };
  for (const c of rows) if (total(c.id) > 0) paths.push({ path: `/catalog/${c.slug}` });

  for (const p of listPublishedProductStamps(db)) {
    const t = Date.parse(p.updatedAt);
    paths.push({ path: `/product/${p.slug}`, lastModified: Number.isNaN(t) ? undefined : new Date(t) });
  }

  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const p of paths) {
    const url = absoluteUrl(opts.siteUrl, p.path);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(p.lastModified ? { url, lastModified: p.lastModified } : { url });
  }
  return out;
}

/** Делит список на файлы не больше size URL (когда товаров станет больше 50 000 — подключить generateSitemaps). */
export function splitSitemap<T>(entries: T[], size: number = SITEMAP_LIMIT): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < entries.length; i += size) parts.push(entries.slice(i, i + size));
  return parts;
}

