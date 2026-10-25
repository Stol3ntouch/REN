import type { Db } from '../connection';

export const productCategoriesRepo = {
  /** Дополнительные категории товара (без основной), по порядку. */
  listExtra(db: Db, productId: number): number[] {
    return (db.prepare('SELECT category_id FROM product_categories WHERE product_id = ? AND is_primary = 0 ORDER BY sort, category_id').all(productId) as { category_id: number }[]).map((r) => r.category_id);
  },

  /**
   * Заменяет дополнительные категории. Основная (is_primary = 1) не трогается — её ведёт products.category_id
   * через триггеры; переданная в списке основная пропускается.
   */
  setExtra(db: Db, productId: number, primaryId: number, extraIds: readonly number[]): void {
    db.prepare('DELETE FROM product_categories WHERE product_id = ? AND is_primary = 0').run(productId);
    const ins = db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary, sort) VALUES (?, ?, 0, ?)');
    let sort = 1;
    for (const id of extraIds) if (id !== primaryId) ins.run(productId, id, sort++);
  },

  /** Какие из категорий существуют. */
  existing(db: Db, ids: readonly number[]): Set<number> {
    if (ids.length === 0) return new Set();
    const rows = db.prepare('SELECT id FROM categories WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as { id: number }[];
    return new Set(rows.map((r) => r.id));
  },
};
