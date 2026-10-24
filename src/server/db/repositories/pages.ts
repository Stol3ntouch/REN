import { createHash } from 'node:crypto';
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
  canonical: string | null;
  noindex: boolean;
  body: string;
  legalDraft: boolean;
  /** Опубликована (false — черновик). Запланированная = опубликована с publishedAt в будущем. */
  published: boolean;
  publishedAt: number | null;
  /** Скрыта администратором (F6): публичные запросы её не отдают, админка видит. */
  hiddenByAdmin: boolean;
  sort: number;
  createdAt: number;
  updatedAt: number;
};
export type PageWrite = Partial<Omit<PageRow, 'id' | 'updatedAt' | 'key' | 'hiddenByAdmin'>>;

const base = makeContentRepo<PageRow, PageWrite>({
  table: 'pages',
  columns: ['slug', 'title', 'h1', 'seoTitle', 'seoDescription', 'canonical', 'noindex', 'body', 'legalDraft', 'published', 'publishedAt', 'sort', 'createdAt'],
  booleans: ['legalDraft', 'hiddenByAdmin', 'noindex', 'published'],
  order: 'sort, id',
});

/** Снимок страницы до правки. */
export type PageVersionRow = {
  id: number;
  pageId: number;
  title: string;
  h1: string | null;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  canonical: string | null;
  noindex: boolean;
  savedBy: number | null;
  createdAt: number;
};

type RawVersion = {
  id: number;
  page_id: number;
  title: string;
  h1: string | null;
  body: string;
  seo_title: string | null;
  seo_description: string | null;
  canonical: string | null;
  noindex: number;
  saved_by: number | null;
  created_at: number;
};

const mapVersion = (r: RawVersion): PageVersionRow => ({
  id: r.id,
  pageId: r.page_id,
  title: r.title,
  h1: r.h1,
  body: r.body,
  seoTitle: r.seo_title,
  seoDescription: r.seo_description,
  canonical: r.canonical,
  noindex: r.noindex === 1,
  savedBy: r.saved_by,
  createdAt: r.created_at,
});

export const PAGE_VERSIONS_KEPT = 20;

export const pageVersionsRepo = {
  /** Сохраняет снимок страницы и оставляет только последние PAGE_VERSIONS_KEPT. */
  snapshot(db: Db, page: PageRow, savedBy: number | null, now: number): number {
    const r = db
      .prepare(
        `INSERT INTO page_versions (page_id, title, h1, body, seo_title, seo_description, canonical, noindex, saved_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(page.id, page.title, page.h1, page.body, page.seoTitle, page.seoDescription, page.canonical, page.noindex ? 1 : 0, savedBy, now);
    db.prepare(
      'DELETE FROM page_versions WHERE page_id = ? AND id NOT IN (SELECT id FROM page_versions WHERE page_id = ? ORDER BY id DESC LIMIT ?)',
    ).run(page.id, page.id, PAGE_VERSIONS_KEPT);
    return Number(r.lastInsertRowid);
  },
  list(db: Db, pageId: number): PageVersionRow[] {
    return (db.prepare('SELECT * FROM page_versions WHERE page_id = ? ORDER BY id DESC').all(pageId) as RawVersion[]).map(mapVersion);
  },
  get(db: Db, pageId: number, versionId: number): PageVersionRow | null {
    const r = db.prepare('SELECT * FROM page_versions WHERE page_id = ? AND id = ?').get(pageId, versionId) as RawVersion | undefined;
    return r ? mapVersion(r) : null;
  },
};

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
  /** Все занятые адреса страниц (для проверки конфликтов). */
  allSlugs(db: Db): string[] {
    return (db.prepare('SELECT slug FROM pages').all() as { slug: string }[]).map((r) => r.slug);
  },
};

// ---------- одноразовые ссылки предпросмотра ----------

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const previewTokensRepo = {
  insert(db: Db, v: { token: string; entity: 'pages' | 'news'; entityId: number; createdBy: number | null; expiresAt: number }): void {
    db.prepare('INSERT INTO content_preview_tokens (token_hash, entity, entity_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)').run(
      hashToken(v.token),
      v.entity,
      v.entityId,
      v.createdBy,
      v.expiresAt,
    );
  },
  /** Атомарно погашает токен: вернёт запись один раз, пока не истёк и не использован. */
  consume(db: Db, token: string, now: number): { entity: 'pages' | 'news'; entityId: number } | null {
    const h = hashToken(token);
    const r = db.prepare('UPDATE content_preview_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?').run(now, h, now);
    if (Number(r.changes) === 0) return null;
    const row = db.prepare('SELECT entity, entity_id FROM content_preview_tokens WHERE token_hash = ?').get(h) as { entity: 'pages' | 'news'; entity_id: number };
    return { entity: row.entity, entityId: row.entity_id };
  },
  /** Чистит истёкшие и использованные токены. */
  purge(db: Db, now: number): void {
    db.prepare('DELETE FROM content_preview_tokens WHERE expires_at < ? OR used_at IS NOT NULL').run(now - 86_400_000);
  },
};
