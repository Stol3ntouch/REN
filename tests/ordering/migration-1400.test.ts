import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@/server/db/connection';
import { runMigrations } from '@/server/db/migrate';
import { addProduct, rawOrder } from './helpers';

const MIGRATIONS = resolve(__dirname, '../../migrations');

/** Миграции до C09 (< 1400): так выглядит рабочая БД перед обновлением. */
function legacy(): Db {
  const dir = mkdtempSync(join(tmpdir(), 'rts-mig1400-'));
  for (const f of readdirSync(MIGRATIONS)) if (/^\d{4}_/.test(f) && Number(f.slice(0, 4)) < 1400) copyFileSync(join(MIGRATIONS, f), join(dir, f));
  const db = openDatabase(':memory:');
  runMigrations(db, { dir });
  return db;
}

describe('миграция 1400: заказы без потери данных', () => {
  it('заказы, строки, события, платежи и экспорт 1С переживают пересоздание таблицы', () => {
    const db = legacy();
    const p = addProduct(db);
    const a = rawOrder(db, 'processing', { paid: true });
    const b = rawOrder(db, 'shipped');
    db.prepare("INSERT INTO order_items (order_id, product_id, name, sku, price_kopecks, unit_kopecks, qty, line_kopecks) VALUES (?, ?, 'Товар', 'S', 100, 100, 2, 200)").run(a.id, p);
    db.prepare("INSERT INTO order_events (order_id, at, kind, to_status, actor_type) VALUES (?, 5, 'created', 'new', 'customer')").run(a.id);
    db.prepare("INSERT INTO payments (order_id, provider, status, amount_kopecks, external_id, created_at, updated_at) VALUES (?, 'test', 'succeeded', 100, 'ext-1', 1, 1)").run(a.id);
    db.prepare("INSERT INTO webhook_events (provider, event_id, event_type, order_id, outcome, received_at) VALUES ('test', 'e1', 'payment.succeeded', ?, 'processed', 1)").run(a.id);
    db.prepare("INSERT INTO onec_exports (order_number, order_id, file_name, payload_hash, exported_at) VALUES (?, ?, 'f.xml', 'h', 1)").run(b.number, b.id);
    const before = db.prepare('SELECT * FROM orders ORDER BY id').all();

    runMigrations(db, { dir: MIGRATIONS });

    expect(db.prepare('SELECT * FROM orders ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?').get(a.id)).toEqual({ c: 1 });
    expect(db.prepare('SELECT kind FROM order_events WHERE order_id = ?').all(a.id)).toEqual([{ kind: 'created' }]);
    expect(db.prepare('SELECT COUNT(*) AS c FROM payments WHERE order_id = ?').get(a.id)).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM webhook_events WHERE order_id = ?').get(a.id)).toEqual({ c: 1 });
    expect(db.prepare('SELECT order_id FROM onec_exports').get()).toEqual({ order_id: b.id });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('новый статус confirmed допустим, несуществующий — нет; новые виды событий принимаются', () => {
    const db = legacy();
    runMigrations(db, { dir: MIGRATIONS });
    const o = rawOrder(db, 'confirmed');
    expect(db.prepare('SELECT status FROM orders WHERE id = ?').get(o.id)).toEqual({ status: 'confirmed' });
    expect(() => db.prepare("UPDATE orders SET status = 'bogus' WHERE id = ?").run(o.id)).toThrow();
    for (const kind of ['revert', 'edit', 'items', 'payment.manual']) {
      db.prepare("INSERT INTO order_events (order_id, at, kind, actor_type) VALUES (?, 1, ?, 'staff')").run(o.id, kind);
    }
  });

  it('нумерация id продолжается, каскад по внешним ключам работает после пересоздания', () => {
    const db = legacy();
    const a = rawOrder(db, 'new');
    runMigrations(db, { dir: MIGRATIONS });
    const b = rawOrder(db, 'new');
    expect(b.id).toBeGreaterThan(a.id);
    db.prepare("INSERT INTO order_events (order_id, at, kind, actor_type) VALUES (?, 1, 'created', 'customer')").run(b.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(b.id);
    expect(db.prepare('SELECT COUNT(*) AS c FROM order_events WHERE order_id = ?').get(b.id)).toEqual({ c: 0 });
  });
});
