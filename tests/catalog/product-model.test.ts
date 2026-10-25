import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { defaultMigrationsDir, runMigrations } from '@/server/db/migrate';
import { addCategory, addProduct, createTestDb } from './helpers';

const tmp = mkdtempSync(join(tmpdir(), 'rts-mig-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('миграция 1200: модель товара', () => {
  it('существующие данные импорта сохраняются: in_stock приводится к availability, категория — к product_categories, created_at = first_seen_at', () => {
    const dir = mkdtempSync(join(tmp, 'before-'));
    for (const f of readdirSync(defaultMigrationsDir())) if (Number(f.slice(0, 4)) < 1200) copyFileSync(join(defaultMigrationsDir(), f), join(dir, f));
    const db = openDatabase(':memory:');
    runMigrations(db, { dir });

    const cat = Number(db.prepare("INSERT INTO categories (external_id, name, slug) VALUES ('c', 'К', 'k')").run().lastInsertRowid);
    const ins = db.prepare(
      "INSERT INTO products (external_id, sku, name, slug, category_id, price_kopecks, in_stock, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, 1000, ?, '2026-01-01T00:00:00.000Z', 'u')",
    );
    ins.run('1', 'A', 'В наличии', 'a', cat, 1);
    ins.run('2', 'B', 'Нет', 'b', cat, 0);

    const { applied } = runMigrations(db);
    expect(applied).toContain('1200_product_model');

    const rows = db.prepare('SELECT name, in_stock, availability, stock_qty, reserved_qty, stock_tracked, availability_manual, indexable, is_new, is_promo, created_at, old_price_kopecks, purchase_price_kopecks FROM products ORDER BY id').all();
    expect(rows).toEqual([
      expect.objectContaining({ name: 'В наличии', in_stock: 1, availability: 'in_stock', stock_qty: 0, reserved_qty: 0, stock_tracked: 0, availability_manual: 0, indexable: 1, is_new: 0, is_promo: 0, created_at: '2026-01-01T00:00:00.000Z', old_price_kopecks: null, purchase_price_kopecks: null }),
      expect.objectContaining({ name: 'Нет', in_stock: 0, availability: 'out_of_stock' }),
    ]);
    expect(db.prepare('SELECT product_id, category_id, is_primary FROM product_categories ORDER BY product_id').all()).toEqual([
      { product_id: 1, category_id: cat, is_primary: 1 },
      { product_id: 2, category_id: cat, is_primary: 1 },
    ]);
    // повторный запуск ничего не меняет
    expect(runMigrations(db).applied).toEqual([]);
  });

  it('индексы и таблицы на месте', () => {
    const db = createTestDb();
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('index','table')").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['product_categories', 'stock_movements', 'idx_products_barcode', 'idx_products_visibility', 'idx_products_sku', 'idx_products_brand', 'idx_products_category']));
  });

  it('БД не допускает: отрицательный остаток или резерв, резерв больше остатка, неизвестный статус наличия, один товар с двумя основными категориями', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const cat2 = addCategory(db, 'К2', 'k2');
    const id = addProduct(db, { name: 'Т', categoryId: cat });
    expect(() => db.prepare('UPDATE products SET stock_qty = -1 WHERE id = ?').run(id)).toThrow();
    expect(() => db.prepare('UPDATE products SET reserved_qty = -1 WHERE id = ?').run(id)).toThrow();
    expect(() => db.prepare('UPDATE products SET reserved_qty = 1 WHERE id = ?').run(id)).toThrow(/exceeds/);
    expect(() => db.prepare("UPDATE products SET availability = 'maybe' WHERE id = ?").run(id)).toThrow();
    expect(() => db.prepare('INSERT INTO product_categories (product_id, category_id, is_primary) VALUES (?, ?, 1)').run(id, cat2)).toThrow();
    db.prepare('UPDATE products SET stock_qty = 3, reserved_qty = 3 WHERE id = ?').run(id);
  });

  it('история остатков и связи удаляются вместе с товаром', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const id = addProduct(db, { name: 'Т', categoryId: cat });
    db.prepare("INSERT INTO stock_movements (product_id, delta, qty_after, reason, created_at) VALUES (?, 1, 1, 'x', 'now')").run(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_categories').get()).toEqual({ n: 0 });
  });
});
