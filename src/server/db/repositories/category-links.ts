import type { Db } from '../connection';

export type RelatedRow = { id: number; name: string; slug: string; sort: number };
export type FilterSettingRow = { filterId: number; sort: number | null; enabled: boolean };
export type BannerLinkRow = { bannerId: number; title: string; status: 'active' | 'inactive'; sort: number; enabled: boolean; hasImage: boolean };
export type BannerChoice = { id: number; title: string };

/**
 * Связи категории с другими сущностями: связанные категории («Смотрите также»), настройки фильтров по категории
 * и привязки баннеров. SQL только здесь (правило проекта); все запросы параметризованы.
 */
export const categoryLinksRepo = {
  // --- связанные категории (category_related)
  listRelated(db: Db, categoryId: number): RelatedRow[] {
    return db
      .prepare(
        `SELECT c.id AS id, c.name AS name, c.slug AS slug, r.sort AS sort
           FROM category_related r JOIN categories c ON c.id = r.related_id
          WHERE r.category_id = ? ORDER BY r.sort, c.name`,
      )
      .all(categoryId) as RelatedRow[];
  },

  /** Витрина: только видимые покупателю связанные категории. */
  listRelatedVisible(db: Db, categoryId: number): RelatedRow[] {
    return db
      .prepare(
        `SELECT c.id AS id, c.name AS name, c.slug AS slug, r.sort AS sort
           FROM category_related r JOIN categories c ON c.id = r.related_id
          WHERE r.category_id = ? AND c.effective_hidden = 0 AND c.show_in_catalog = 1 ORDER BY r.sort, c.name`,
      )
      .all(categoryId) as RelatedRow[];
  },

  /** Заменяет связи целиком: пары уникальны (дубликаты в списке схлопываются), связь с собой пропускается. */
  replaceRelated(db: Db, categoryId: number, relatedIds: readonly number[]): void {
    db.prepare('DELETE FROM category_related WHERE category_id = ?').run(categoryId);
    const ins = db.prepare('INSERT OR IGNORE INTO category_related (category_id, related_id, sort) VALUES (?, ?, ?)');
    let sort = 0;
    for (const id of relatedIds) {
      if (id === categoryId) continue;
      if (ins.run(categoryId, id, sort).changes > 0) sort += 1;
    }
  },

  // --- фильтры по категории (category_filter_settings)
  listFilterSettings(db: Db, categoryId: number): FilterSettingRow[] {
    return (db.prepare('SELECT filter_id, sort, enabled FROM category_filter_settings WHERE category_id = ?').all(categoryId) as { filter_id: number; sort: number | null; enabled: number }[]).map((r) => ({
      filterId: r.filter_id,
      sort: r.sort,
      enabled: r.enabled === 1,
    }));
  },

  /** Все настройки (для витрины): категория → фильтр → настройка. Чтение одним запросом. */
  listAllFilterSettings(db: Db): { categoryId: number; filterId: number; sort: number | null; enabled: boolean }[] {
    return (db.prepare('SELECT category_id, filter_id, sort, enabled FROM category_filter_settings').all() as { category_id: number; filter_id: number; sort: number | null; enabled: number }[]).map((r) => ({
      categoryId: r.category_id,
      filterId: r.filter_id,
      sort: r.sort,
      enabled: r.enabled === 1,
    }));
  },

  replaceFilterSettings(db: Db, categoryId: number, rows: readonly FilterSettingRow[]): void {
    db.prepare('DELETE FROM category_filter_settings WHERE category_id = ?').run(categoryId);
    const ins = db.prepare('INSERT INTO category_filter_settings (category_id, filter_id, sort, enabled) VALUES (?, ?, ?, ?)');
    for (const r of rows) ins.run(categoryId, r.filterId, r.sort, r.enabled ? 1 : 0);
  },

  existingFilterIds(db: Db, ids: readonly number[]): Set<number> {
    if (ids.length === 0) return new Set();
    return new Set((db.prepare('SELECT id FROM catalog_filters WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as { id: number }[]).map((r) => r.id));
  },

  // --- баннеры (banner_categories)
  listBannerLinks(db: Db, categoryId: number): BannerLinkRow[] {
    return (
      db
        .prepare(
          `SELECT b.id AS id, b.title AS title, b.status AS status, bc.sort AS sort, bc.enabled AS enabled, b.image_path IS NOT NULL AS has_image
             FROM banner_categories bc JOIN banners b ON b.id = bc.banner_id
            WHERE bc.category_id = ? ORDER BY bc.sort, b.id`,
        )
        .all(categoryId) as { id: number; title: string; status: 'active' | 'inactive'; sort: number; enabled: number; has_image: number }[]
    ).map((r) => ({ bannerId: r.id, title: r.title, status: r.status, sort: r.sort, enabled: r.enabled === 1, hasImage: r.has_image === 1 }));
  },

  /** Баннеры позиции «category», ещё не привязанные к этой категории. */
  listBannerChoices(db: Db, categoryId: number): BannerChoice[] {
    return db
      .prepare(
        `SELECT id, title FROM banners
          WHERE position = 'category' AND id NOT IN (SELECT banner_id FROM banner_categories WHERE category_id = ?)
          ORDER BY title, id`,
      )
      .all(categoryId) as BannerChoice[];
  },

  bannerIsForCategories(db: Db, bannerId: number): boolean {
    return db.prepare("SELECT 1 AS ok FROM banners WHERE id = ? AND position = 'category'").get(bannerId) !== undefined;
  },

  /** Привязка баннера; повтор — без ошибки (пара уникальна). true — привязка создана. */
  addBannerLink(db: Db, categoryId: number, bannerId: number, sort: number): boolean {
    return db.prepare('INSERT OR IGNORE INTO banner_categories (banner_id, category_id, sort, enabled) VALUES (?, ?, ?, 1)').run(bannerId, categoryId, sort).changes > 0;
  },

  updateBannerLink(db: Db, categoryId: number, bannerId: number, patch: { sort?: number; enabled?: boolean }): boolean {
    const sets: string[] = [];
    const values: number[] = [];
    if (patch.sort !== undefined) {
      sets.push('sort = ?');
      values.push(patch.sort);
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (sets.length === 0) return false;
    return db.prepare(`UPDATE banner_categories SET ${sets.join(', ')} WHERE category_id = ? AND banner_id = ?`).run(...values, categoryId, bannerId).changes > 0;
  },

  removeBannerLink(db: Db, categoryId: number, bannerId: number): boolean {
    return db.prepare('DELETE FROM banner_categories WHERE category_id = ? AND banner_id = ?').run(categoryId, bannerId).changes > 0;
  },

  nextBannerSort(db: Db, categoryId: number): number {
    return (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM banner_categories WHERE category_id = ?').get(categoryId) as { n: number }).n;
  },
};
