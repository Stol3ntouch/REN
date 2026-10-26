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
  /** «Активная» (C06): неактивная категория недоступна на сайте вместе с поддеревом. */
  active: boolean;
  description: string | null;
  imagePath: string | null;
  imageVariants: string | null;
  showInMenu: boolean;
  showOnHome: boolean;
  showInCatalog: boolean;
  /** Чем меньше, тем выше категория в списках (затем позиция sort). */
  priority: number;
  /** Уникальный системный код. */
  code: string | null;
  externalRef: string | null;
  /** Комментарий администратора: на сайте не публикуется. */
  adminComment: string | null;
  canonical: string | null;
  indexable: boolean;
  /** Название / родитель правили вручную: импорт YML их не перезаписывает. */
  lockedName: boolean;
  lockedParent: boolean;
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
  active: number;
  description: string | null;
  image_path: string | null;
  image_variants: string | null;
  show_in_menu: number;
  show_on_home: number;
  show_in_catalog: number;
  priority: number;
  code: string | null;
  external_ref: string | null;
  admin_comment: string | null;
  canonical: string | null;
  indexable: number;
  locked_name: number;
  locked_parent: number;
};

const COLUMNS =
  'id, source, external_id, parent_id, name, slug, seo_title, seo_description, h1, seo_text, sort, hidden_by_admin, effective_hidden, active, description, image_path, image_variants, show_in_menu, show_on_home, show_in_catalog, priority, code, external_ref, admin_comment, canonical, indexable, locked_name, locked_parent';
/** Порядок показа: приоритет (меньше — выше), позиция, id. */
const ORDER = 'priority, sort, id';

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
    active: r.active === 1,
    description: r.description,
    imagePath: r.image_path,
    imageVariants: r.image_variants,
    showInMenu: r.show_in_menu === 1,
    showOnHome: r.show_on_home === 1,
    showInCatalog: r.show_in_catalog === 1,
    priority: r.priority,
    code: r.code,
    externalRef: r.external_ref,
    adminComment: r.admin_comment,
    canonical: r.canonical,
    indexable: r.indexable === 1,
    lockedName: r.locked_name === 1,
    lockedParent: r.locked_parent === 1,
  };
}

/**
 * Эффективно скрытые категории: скрытая сама или имеющая скрытого предка. Чистая функция (шов для тестов и пересчёта).
 * Цикл в родителях (битые данные) не зацикливает: обход останавливается на уже виденной категории.
 */
export function computeEffectiveHidden(rows: { id: number; parentId: number | null; hiddenByAdmin: boolean; inactive?: boolean }[]): Set<number> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Set<number>();
  for (const r of rows) {
    const seen = new Set<number>();
    for (let cur: (typeof rows)[number] | undefined = r; cur && !seen.has(cur.id); cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) {
      seen.add(cur.id);
      if (cur.hiddenByAdmin || cur.inactive) {
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
    return (db.prepare(`SELECT ${COLUMNS} FROM categories ORDER BY ${ORDER}`).all() as Raw[]).map(map);
  },

  /** Категории, которые видит покупатель: без скрытых и без потомков скрытых. */
  listVisible(db: Db): CategoryRow[] {
    return (db.prepare(`SELECT ${COLUMNS} FROM categories WHERE effective_hidden = 0 ORDER BY ${ORDER}`).all() as Raw[]).map(map);
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
    const rows = db.prepare('SELECT id, parent_id, hidden_by_admin, active, effective_hidden FROM categories').all() as { id: number; parent_id: number | null; hidden_by_admin: number; active: number; effective_hidden: number }[];
    const hidden = computeEffectiveHidden(rows.map((r) => ({ id: r.id, parentId: r.parent_id, hiddenByAdmin: r.hidden_by_admin === 1, inactive: r.active === 0 })));
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

  /**
   * Обновляет название и/или родителя (путь импорта); SEO-поля, slug и ручные поля CMS импорт не трогает.
   * Название и родитель, закреплённые ручной правкой (locked_*), не меняются.
   */
  update(db: Db, id: number, patch: { name?: string; parentId?: number | null }): void {
    if (patch.name !== undefined) db.prepare('UPDATE categories SET name = ? WHERE id = ? AND locked_name = 0').run(patch.name, id);
    if (patch.parentId !== undefined) db.prepare('UPDATE categories SET parent_id = ? WHERE id = ? AND locked_parent = 0').run(patch.parentId, id);
  },

  findByCode(db: Db, code: string): CategoryRow | undefined {
    const r = db.prepare(`SELECT ${COLUMNS} FROM categories WHERE code = ?`).get(code) as Raw | undefined;
    return r && map(r);
  },

  /** Категория, созданная в админке (не из импорта): source = admin, внешний ключ — случайный. */
  insertManual(db: Db, c: { externalId: string; parentId: number | null; name: string; slug: string; sort: number }): number {
    return categoriesRepo.insert(db, { source: 'admin', ...c });
  },

  /** Правка полей карточки из админки. Только перечисленные ключи; название и родитель закрепляются за ручной правкой. */
  updateCard(db: Db, id: number, patch: CardPatch): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, column] of Object.entries(CARD_COLUMNS) as [keyof CardPatch, string][]) {
      const v = patch[key];
      if (v === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    if (patch.name !== undefined) sets.push('locked_name = 1');
    if (patch.parentId !== undefined) sets.push('locked_parent = 1');
    if (sets.length === 0) return;
    db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  },

  delete(db: Db, id: number): void {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  },

  /** Следующая позиция среди детей родителя (в конец списка). */
  nextSort(db: Db, parentId: number | null): number {
    const r = (parentId === null
      ? db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM categories WHERE parent_id IS NULL').get()
      : db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM categories WHERE parent_id = ?').get(parentId)) as { n: number };
    return r.n;
  },

  /** Пары «категория — товар» для опубликованных и не скрытых вручную товаров (счётчики админки; основная и дополнительные привязки). */
  liveProductLinks(db: Db): { categoryId: number; productId: number }[] {
    return (
      db
        .prepare('SELECT pc.category_id AS cid, pc.product_id AS pid FROM product_categories pc JOIN products p ON p.id = pc.product_id WHERE p.published = 1 AND p.hidden_by_admin = 0')
        .all() as { cid: number; pid: number }[]
    ).map((r) => ({ categoryId: r.cid, productId: r.pid }));
  },

  setSort(db: Db, id: number, sort: number): void {
    db.prepare('UPDATE categories SET sort = ? WHERE id = ?').run(sort, id);
  },

  /** Сколько товаров привязано к категории напрямую (основная и дополнительные привязки). */
  directProductCount(db: Db, id: number): number {
    return (db.prepare('SELECT COUNT(DISTINCT product_id) AS n FROM product_categories WHERE category_id = ?').get(id) as { n: number }).n;
  },
};

/** Ключ патча карточки → колонка. */
const CARD_COLUMNS = {
  name: 'name',
  slug: 'slug',
  parentId: 'parent_id',
  description: 'description',
  active: 'active',
  showInMenu: 'show_in_menu',
  showOnHome: 'show_on_home',
  showInCatalog: 'show_in_catalog',
  sort: 'sort',
  priority: 'priority',
  code: 'code',
  externalRef: 'external_ref',
  adminComment: 'admin_comment',
  canonical: 'canonical',
  indexable: 'indexable',
  seoTitle: 'seo_title',
  seoDescription: 'seo_description',
  h1: 'h1',
  seoText: 'seo_text',
  imagePath: 'image_path',
  imageVariants: 'image_variants',
} as const;

export type CardPatch = {
  name?: string;
  slug?: string;
  parentId?: number | null;
  description?: string | null;
  active?: boolean;
  showInMenu?: boolean;
  showOnHome?: boolean;
  showInCatalog?: boolean;
  sort?: number;
  priority?: number;
  code?: string | null;
  externalRef?: string | null;
  adminComment?: string | null;
  canonical?: string | null;
  indexable?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
  h1?: string | null;
  seoText?: string | null;
  imagePath?: string | null;
  imageVariants?: string | null;
};
