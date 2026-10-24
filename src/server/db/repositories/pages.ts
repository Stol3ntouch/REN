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
  /** Скрыта администратором (F6): публичные запросы её не отдают, админка видит. */
  hiddenByAdmin: boolean;
  sort: number;
  updatedAt: number;
};
export type PageWrite = Partial<Omit<PageRow, 'id' | 'updatedAt' | 'key' | 'hiddenByAdmin'>>;

const base = makeContentRepo<PageRow, PageWrite>({
  table: 'pages',
  columns: ['slug', 'title', 'h1', 'seoTitle', 'seoDescription', 'body', 'legalDraft', 'sort'],
  booleans: ['legalDraft', 'hiddenByAdmin'],
  order: 'sort, id',
});

export const pagesRepo = {
  ...base,
  /** Ставит или снимает скрытие. updated_at не трогаем: это не правка текста страницы. */
  setHidden(db: Db, id: number, hidden: boolean): void {
    db.prepare('UPDATE pages SET hidden_by_admin = ? WHERE id = ?').run(hidden ? 1 : 0, id);
  },
  findByKey(db: Db, key: string): PageRow | null {
    const r = db.prepare('SELECT id FROM pages WHERE key = ?').get(key) as { id: number } | undefined;
    return r ? base.get(db, r.id) : null;
  },
};
