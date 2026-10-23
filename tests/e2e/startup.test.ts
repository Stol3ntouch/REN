import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { setPopularitySource } from '@/domain/catalog/popularity';
import { searchProducts } from '@/domain/catalog';
import { setMailEnqueue, enqueueMail } from '@/domain/admin/mail-enqueue';
import { connectApp } from '@/server/startup';
import { setPaymentRunLogger } from '@/integrations/payment/service';
import { stopMailWorker } from '@/integrations/mail';
import { createTestDb } from '@/server/db/testing';
import { addProduct, rawOrder } from '../ordering/helpers';

// getDb() (синглтон приложения) работает во временной папке, а не в data/.
const TMP = mkdtempSync(join(tmpdir(), 'rts-startup-'));
process.env.DATABASE_PATH = join(TMP, 'rts.sqlite');
process.env.DATA_DIR = TMP;

afterAll(async () => (await import('@/server/db/connection')).closeDb());

afterEach(() => {
  stopMailWorker();
  setPopularitySource(null);
  setMailEnqueue(null);
  setPaymentRunLogger(null);
});

function sell(db: ReturnType<typeof createTestDb>, productId: number, qty: number, status: Parameters<typeof rawOrder>[1]) {
  const o = rawOrder(db, status);
  db.prepare('INSERT INTO order_items (order_id, product_id, name, sku, price_kopecks, unit_kopecks, qty, line_kopecks) VALUES (?, ?, ?, ?, 100, 100, ?, ?)').run(
    o.id, productId, 'x', 'x', qty, qty * 100,
  );
}

describe('подключение при старте приложения', () => {
  it('сортировка «популярные» считает единицы в неотменённых заказах', async () => {
    const db = createTestDb();
    const a = addProduct(db, { name: 'Аааа', sku: 'A-1', price: 100 });
    const b = addProduct(db, { name: 'Яяяя', sku: 'B-1', price: 100 });
    const c = addProduct(db, { name: 'Ббб', sku: 'C-1', price: 100 });
    sell(db, b, 3, 'processing');
    sell(db, c, 5, 'cancelled'); // отменённый не считается
    sell(db, a, 1, 'delivered');
    connectApp({ startMailWorker: false });
    const res = await searchProducts({ filters: {}, sort: 'popular', page: 1, pageSize: 20 }, { db });
    expect(res.items.map((p) => p.id)).toEqual([b, a, c]);
  });

  it('почта подключена: enqueueMail пишет в email_outbox, а не в заглушку', async () => {
    connectApp({ startMailWorker: false });
    const { getDb } = await import('@/server/db/connection');
    const db = getDb();
    const before = (db.prepare('SELECT COUNT(*) AS n FROM email_outbox').get() as { n: number }).n;
    enqueueMail('integration.failed', { integration: '1С', message: 'нет связи' });
    const after = (db.prepare('SELECT COUNT(*) AS n FROM email_outbox').get() as { n: number }).n;
    expect(after).toBeGreaterThan(before);
  });
});
