import type { Db } from '../connection';

export type AttributeValue = { name: string; value: string };

export const attributesRepo = {
  /** Характеристики товара в исходном порядке. */
  listByProduct(db: Db, productId: number): AttributeValue[] {
    return db
      .prepare(
        `SELECT d.name AS name, a.value AS value FROM product_attributes a
         JOIN attribute_definitions d ON d.id = a.attribute_id
         WHERE a.product_id = ? ORDER BY a.sort, a.id`,
      )
      .all(productId) as AttributeValue[];
  },

  /** Полностью заменяет характеристики товара; определения (имена) создаются при первом использовании. */
  replaceForProduct(db: Db, productId: number, attrs: AttributeValue[]): void {
    db.prepare('DELETE FROM product_attributes WHERE product_id = ?').run(productId);
    const upsert = db.prepare('INSERT INTO attribute_definitions (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id');
    const insert = db.prepare('INSERT INTO product_attributes (product_id, attribute_id, value, sort) VALUES (?, ?, ?, ?)');
    attrs.forEach((a, sort) => {
      const def = upsert.get(a.name) as { id: number };
      insert.run(productId, def.id, a.value, sort);
    });
  },

  countDefinitions(db: Db): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM attribute_definitions').get() as { n: number }).n;
  },
};
