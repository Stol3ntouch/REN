import type { Db } from '../connection';
import { makeContentRepo } from './content-base';

export type PageRow = {
  id: number;
  key: string | null;
  slug: string;
  title: string;
  h1: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  body: string;
  legalDraft: boolean;
  sort: number;
  updatedAt: number;
};
export type PageWrite = Partial<Omit<PageRow, 'id' | 'updatedAt' | 'key'>>;

const base = makeContentRepo<PageRow, PageWrite>({
  table: 'pages',
  columns: ['slug', 'title', 'h1', 'seoTitle', 'seoDescription', 'body', 'legalDraft', 'sort'],
  booleans: ['legalDraft'],
  order: 'sort, id',
});

export const pagesRepo = {
  ...base,
  findByKey(db: Db, key: string): PageRow | null {
    const r = db.prepare('SELECT id FROM pages WHERE key = ?').get(key) as { id: number } | undefined;
    return r ? base.get(db, r.id) : null;
  },
};
