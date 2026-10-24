import type { Db } from '../connection';
import { makeContentRepo } from './content-base';

export type NewsRow = {
  id: number;
  slug: string;
  title: string;
  h1: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonical: string | null;
  noindex: boolean;
  excerpt: string | null;
  body: string;
  imagePath: string | null;
  imageVariants: string | null;
  imageAlt: string | null;
  published: boolean;
  publishedAt: number | null;
  categoryId: number | null;
  authorStaffId: number | null;
  authorName: string | null;
  updatedAt: number;
};
export type NewsWrite = Partial<Omit<NewsRow, 'id' | 'updatedAt'>>;

const base = makeContentRepo<NewsRow, NewsWrite>({
  table: 'news',
  columns: [
    'slug', 'title', 'h1', 'seoTitle', 'seoDescription', 'canonical', 'noindex', 'excerpt', 'body', 'imagePath', 'imageVariants', 'imageAlt',
    'published', 'publishedAt', 'categoryId', 'authorStaffId', 'authorName',
  ],
  booleans: ['published', 'noindex'],
  order: 'COALESCE(published_at, updated_at) DESC, id DESC',
});

/** Видимая на сайте новость: опубликована и время публикации наступило. */
export const NEWS_LIVE_SQL = '(published = 1 AND (published_at IS NULL OR published_at <= ?))';

export const newsRepo = {
  ...base,
  /** Опубликованные на момент now, новые сверху; category — id категории. Страница по limit/offset. */
  listLive(db: Db, now: number, o: { categoryId?: number | null; limit?: number; offset?: number } = {}): NewsRow[] {
    const where = o.categoryId ? `${NEWS_LIVE_SQL} AND category_id = ?` : NEWS_LIVE_SQL;
    const params: (number | string)[] = o.categoryId ? [now, o.categoryId] : [now];
    const all = base.list(db, where, params);
    const offset = o.offset ?? 0;
    return all.slice(offset, o.limit === undefined ? undefined : offset + o.limit);
  },
  countLive(db: Db, now: number, categoryId?: number | null): number {
    return categoryId ? base.count(db, `${NEWS_LIVE_SQL} AND category_id = ?`, [now, categoryId]) : base.count(db, NEWS_LIVE_SQL, [now]);
  },
};

/** Сотрудники для выбора автора: id и отображаемое имя (имя или логин), только активные. */
export function listAuthorOptions(db: Db): { id: number; name: string }[] {
  return (db.prepare('SELECT id, COALESCE(NULLIF(name, \'\'), email) AS name FROM staff WHERE active = 1 ORDER BY name').all() as { id: number; name: string }[]);
}

export function staffDisplayName(db: Db, id: number): string | null {
  const r = db.prepare('SELECT COALESCE(NULLIF(name, \'\'), email) AS name FROM staff WHERE id = ?').get(id) as { name: string } | undefined;
  return r?.name ?? null;
}
