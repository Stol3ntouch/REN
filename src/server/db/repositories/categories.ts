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
  /** Скрыта администратором (F6). */
  hiddenByAdmin: boolean;
  /** Скрыта сама или через родителя: итог для витрины. Пересчитывается recomputeEffectiveHidden. */
  effectiveHidden: boolean;
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
  hidden_by_admin: number;
  effective_hidden: number;
};

const COLUMNS = 'id, source, external_id, parent_id, name, slug, seo_title, seo_description, h1, seo_text, sort, hidden_by_admin, effective_hidden';

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
    hiddenByAdmin: r.hidden_by_admin === 1,
    effectiveHidden: r.effective_hidden === 1,
  };
}

/**
 * Эффективно скрытые категории: скрытая сама или имеющая скрытого предка. Чистая функция (шов для тестов и пересчёта).
 * Цикл в родителях (битые данные) не зацикливает: обход останавливается на уже виденной категории.
 */
export function computeEffectiveHidden(rows: { id: number; parentId: number | null; hiddenByAdmin: boolean }[]): Set<number> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Set<number>();
  for (const r of rows) {
    const seen = new Set<number>();
    for (let cur: (typeof rows)[number] | undefined = r; cur && !seen.has(cur.id); cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) {
      seen.add(cur.id);
      if (cur.hiddenByAdmin) {
        out.add(r.id);
        break;
      }
    }
  }
  return out;
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

  /** То же для витрины: скрытая категория (сама или через родителя) не находится. */
  findVisibleBySlug(db: Db, slug: string): CategoryRow | undefined {
    const r = db.prepare(`SELECT ${COLUMNS} FROM categories WHERE slug = ? AND effective_hidden = 0`).get(slug) as Raw | undefined;
    return r && map(r);
  },

  /** Все категории в порядке sort, затем id — вместе со скрытыми (админка, импорт). Витрина читает listVisible. */
  listAll(db: Db): CategoryRow[] {
    return (db.prepare(`SELECT ${COLUMNS} FROM categories ORDER BY sort, id`).all() as Raw[]).map(map);
  },

  /** Категории, которые видит покупатель: без скрытых и без потомков скрытых. */
  listVisible(db: Db): CategoryRow[] {
    return (db.prepare(`SELECT ${COLUMNS} FROM categories WHERE effective_hidden = 0 ORDER BY sort, id`).all() as Raw[]).map(map);
  },

  allSlugs(db: Db): Set<string> {
    return new Set((db.prepare('SELECT slug FROM categories').all() as { slug: string }[]).map((r) => r.slug));
  },

  count(db: Db): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
  },

  insert(db: Db, c: NewCategory): number {
    const r = db
      .prepare(
        // новая подкатегория под скрытой родительской наследует скрытость
        'INSERT INTO categories (source, external_id, parent_id, name, slug, sort, effective_hidden) VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT effective_hidden FROM categories WHERE id = ?), 0))',
      )
      .run(c.source, c.externalId, c.parentId, c.name, c.slug, c.sort, c.parentId);
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

  /** Ставит или снимает признак «скрыта администратором». После него вызвать recomputeEffectiveHidden. */
  setHiddenByAdmin(db: Db, id: number, hidden: boolean): void {
    db.prepare('UPDATE categories SET hidden_by_admin = ? WHERE id = ?').run(hidden ? 1 : 0, id);
  },

  /** Пересчитывает effective_hidden по всему дереву; пишет только изменившиеся строки. Возвращает число изменённых. */
  recomputeEffectiveHidden(db: Db): number {
    const rows = (db.prepare('SELECT id, parent_id, hidden_by_admin, effective_hidden FROM categories').all() as { id: number; parent_id: number | null; hidden_by_admin: number; effective_hidden: number }[]);
    const hidden = computeEffectiveHidden(rows.map((r) => ({ id: r.id, parentId: r.parent_id, hiddenByAdmin: r.hidden_by_admin === 1 })));
    const update = db.prepare('UPDATE categories SET effective_hidden = ? WHERE id = ?');
    let changed = 0;
    for (const r of rows) {
      const next = hidden.has(r.id) ? 1 : 0;
      if (next === r.effective_hidden) continue;
      update.run(next, r.id);
      changed++;
    }
    return changed;
  },

  /** Обновляет название и/или родителя; SEO-поля и slug импорт не трогает. */
  update(db: Db, id: number, patch: { name?: string; parentId?: number | null }): void {
    if (patch.name !== undefined) db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.parentId !== undefined) db.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(patch.parentId, id);
  },
};
