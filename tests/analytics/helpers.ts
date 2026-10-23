import type { Db } from '@/server/db/connection';
import type { OrderStatus } from '@/server/db/repositories/orders';
import { addProduct, rawOrder } from '../ordering/helpers';

export const ms = (iso: string): number => Date.parse(iso);

export type SeedOrder = { at: string; status: OrderStatus; paid?: boolean; total: number; lines?: [productId: number, qty: number, unit: number][] };

export function seedOrder(db: Db, o: SeedOrder): { id: number; number: string } {
  const created = rawOrder(db, o.status, { paid: o.paid, now: ms(o.at) });
  db.prepare('UPDATE orders SET total_kopecks = ?, subtotal_kopecks = ? WHERE id = ?').run(o.total, o.total, created.id);
  for (const [productId, qty, unit] of o.lines ?? []) {
    db.prepare('INSERT INTO order_items (order_id, product_id, name, sku, price_kopecks, unit_kopecks, qty, line_kopecks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      created.id,
      productId,
      (db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as { name: string }).name,
      null,
      unit,
      unit,
      qty,
      qty * unit,
    );
  }
  return created;
}

export function addCategorizedProduct(db: Db, categoryName: string, name: string): number {
  const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(categoryName) as { id: number } | undefined;
  const categoryId =
    cat?.id ??
    Number(db.prepare('INSERT INTO categories (external_id, name, slug) VALUES (?, ?, ?)').run(`cx-${categoryName}`, categoryName, `cat-${Math.random().toString(36).slice(2, 8)}`).lastInsertRowid);
  const id = addProduct(db, { name });
  db.prepare('UPDATE products SET category_id = ? WHERE id = ?').run(categoryId, id);
  return id;
}

/** Набор для проверки агрегатов (октябрь 2026, Москва UTC+3). Ожидания считаются вручную в тестах. */
export function seedOctober(db: Db): { a: number; b: number } {
  const a = addCategorizedProduct(db, 'Генераторы', 'Генератор A');
  const b = addCategorizedProduct(db, 'Триммеры', 'Триммер B');
  seedOrder(db, { at: '2026-10-10T12:00:00+03:00', status: 'delivered', paid: true, total: 300_000, lines: [[a, 2, 100_000], [b, 1, 100_000]] });
  seedOrder(db, { at: '2026-10-10T20:30:00+03:00', status: 'processing', paid: true, total: 100_000, lines: [[a, 1, 100_000]] });
  seedOrder(db, { at: '2026-10-11T01:00:00+03:00', status: 'new', total: 50_000, lines: [[b, 1, 50_000]] }); // 10 октября 22:00 UTC, но 11-е по Москве
  seedOrder(db, { at: '2026-10-12T10:00:00+03:00', status: 'cancelled', total: 70_000, lines: [[a, 1, 70_000]] });
  seedOrder(db, { at: '2026-10-12T11:00:00+03:00', status: 'refunded', paid: false, total: 90_000, lines: [[b, 1, 90_000]] });
  seedOrder(db, { at: '2026-09-30T23:00:00+03:00', status: 'delivered', paid: true, total: 999_000, lines: [[a, 1, 999_000]] }); // вне периода
  return { a, b };
}
