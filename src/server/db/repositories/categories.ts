import type { Db } from '../connection';

export type CategoryRow = {
  id: number;
  source: string;
  externalId: string;
  parentId: number | null;
  name: string;
  slug: string;
  seoTitle: string | null;
  seoDescription: string | null;
  h1: string | null;
  seoText: string | null;
  sort: number;
};

type Raw = {
  id: number;
  source: string;
  external_id: string;
  parent_id: number | null;
  name: string;
  slug: string;
  seo_title: string | null;
  seo_description: string | null;
  h1: string | null;
  seo_text: string | null;
  sort: number;
};

const COLUMNS = 'id, source, external_id, parent_id, name, slug, seo_title, seo_description, h1, seo_text, sort';

function map(r: Raw): CategoryRow {
  return {
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    parentId: r.parent_id,
    name: r.name,
    slug: r.slug,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    h1: r.h1,
    seoText: r.seo_text,
    sort: r.sort,
  };
}

export type NewCategory = { source: string; externalId: string; parentId: number | null; name: string; slug: string; sort: number };

export const categoriesRepo = {
  findByExternalId(db: Db, source: string, externalId: string): CategoryRow | undefined {
    const r = db.prepare(`SELECT ${COLUMNS} FROM categories WHERE source = ? AND external_id = ?`).get(source, externalId) as Raw | undefined;
    return r && map(r);
  },

  findBySlug(db: Db, slug: string): CategoryRow | undefined {
    const r = db.prepare(`SELECT ${COLUMNS} FROM categories WHERE slug = ?`).get(slug) as Raw | undefined;
    return r && map(r);
  },

  /** Все категории в порядке sort, затем id. */
  listAll(db: Db): CategoryRow[] {
    return (db.prepare(`SELECT ${COLUMNS} FROM categories ORDER BY sort, id`).all() as Raw[]).map(map);
  },

  allSlugs(db: Db): Set<string> {
    return new Set((db.prepare('SELECT slug FROM categories').all() as { slug: string }[]).map((r) => r.slug));
  },

  count(db: Db): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
  },

  insert(db: Db, c: NewCategory): number {
    const r = db
      .prepare('INSERT INTO categories (source, external_id, parent_id, name, slug, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.source, c.externalId, c.parentId, c.name, c.slug, c.sort);
    return Number(r.lastInsertRowid);
  },

  findById(db: Db, id: number): CategoryRow | undefined {
    const r = db.prepare(`SELECT ${COLUMNS} FROM categories WHERE id = ?`).get(id) as Raw | undefined;
    return r && map(r);
  },

  /** SEO-поля категории (редактор в админке); импорт их не трогает. */
  updateSeo(db: Db, id: number, seo: { seoTitle: string | null; seoDescription: string | null; h1: string | null; seoText: string | null }): void {
    db.prepare('UPDATE categories SET seo_title = ?, seo_description = ?, h1 = ?, seo_text = ? WHERE id = ?').run(seo.seoTitle, seo.seoDescription, seo.h1, seo.seoText, id);
  },

  /** Обновляет название и/или родителя; SEO-поля и slug импорт не трогает. */
  update(db: Db, id: number, patch: { name?: string; parentId?: number | null }): void {
    if (patch.name !== undefined) db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.parentId !== undefined) db.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(patch.parentId, id);
  },
};
