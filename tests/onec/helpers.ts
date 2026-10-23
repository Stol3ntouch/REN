import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';
import { addProduct, rawOrder } from '../ordering/helpers';

export function tmpData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rts-onec-'));
  mkdirSync(join(dir, 'onec-inbox'), { recursive: true });
  return dir;
}

export function writeInbox(dataDir: string, name: string, content: string): void {
  mkdirSync(join(dataDir, 'onec-inbox'), { recursive: true });
  writeFileSync(join(dataDir, 'onec-inbox', name), content, 'utf8');
}

/** Заказ с одной позицией, чтобы выгрузка имела строки. */
export function orderWithItem(db: Db, status: Parameters<typeof rawOrder>[1] = 'processing', o: Parameters<typeof rawOrder>[2] = {}) {
  const order = rawOrder(db, status, o);
  const pid = addProduct(db, { name: 'Генератор X', sku: 'GX-1', price: 100_000 });
  db.prepare('INSERT INTO order_items (order_id, product_id, name, sku, price_kopecks, unit_kopecks, qty, line_kopecks) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run(
    order.id,
    pid,
    'Генератор X',
    'GX-1',
    100_000,
    100_000,
    100_000,
  );
  return order;
}

export { createTestDb };
