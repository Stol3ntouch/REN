import type { Db } from '../connection';
import { makeContentRepo } from './content-base';
import { NEWS_LIVE_SQL } from './news';

export type NewsCategoryRow = { id: number; slug: string; name: string; sort: number; updatedAt: number };
export type NewsCategoryWrite = Partial<Omit<NewsCategoryRow, 'id' | 'updatedAt'>>;

const catBase = makeContentRepo<NewsCategoryRow, NewsCategoryWrite>({
  table: 'news_categories',
  columns: ['slug', 'name', 'sort'],
  order: 'sort, name, id',
});

export const newsCategoriesRepo = {
  ...catBase,
  /** Сколько новостей в каждой категории (id → число), для списка и фильтра. */
  counts(db: Db, now: number): Map<number, number> {
    const rows = db
      .prepare(`SELECT category_id AS id, COUNT(*) AS n FROM news WHERE category_id IS NOT NULL AND ${NEWS_LIVE_SQL} GROUP BY category_id`)
      .all(now) as { id: number; n: number }[];
    return new Map(rows.map((r) => [r.id, r.n]));
  },
  /** Сколько новостей (любых) ссылается на категорию. */
  usage(db: Db, id: number): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM news WHERE category_id = ?').get(id) as { n: number }).n;
  },
};
