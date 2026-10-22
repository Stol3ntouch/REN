import type { Db } from '@/server/db/connection';
import { ordersRepo, type OrderStatus } from '@/server/db/repositories/orders';
import { createTestDb } from '@/server/db/testing';
import type { OwnerRef } from '@/server/http/owner';

export const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
export const SECRET = 'test-secret-test-secret-test-secret-123456';
export const GUEST_A = { kind: 'guest', guestId: '11111111-1111-4111-8111-111111111111' } as const;
export const GUEST_B = { kind: 'guest', guestId: '22222222-2222-4222-8222-222222222222' } as const;

export type ProductSeed = {
  name?: string;
  sku?: string | null;
  price?: number;
  discount?: number | null;
  inStock?: boolean;
  published?: boolean;
};

let counter = 0;

export function addProduct(db: Db, p: ProductSeed = {}): number {
  counter += 1;
  const cat = db.prepare("SELECT id FROM categories WHERE external_id = 'c1'").get() as { id: number } | undefined;
  const categoryId =
    cat?.id ??
    Number(db.prepare("INSERT INTO categories (external_id, name, slug) VALUES ('c1', 'Тест', 'test')").run().lastInsertRowid);
  const r = db
    .prepare(
      `INSERT INTO products (external_id, sku, name, slug, category_id, price_kopecks, discount_price_kopecks, in_stock, published, first_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'x', 'x')`,
    )
    .run(
      `e${counter}-${Math.random()}`,
      p.sku === undefined ? `SKU-${counter}` : p.sku,
      p.name ?? `Товар ${counter}`,
      `tovar-${counter}-${Math.random().toString(36).slice(2, 8)}`,
      categoryId,
      p.price ?? 100_000,
      p.discount ?? null,
      p.inStock === false ? 0 : 1,
      p.published === false ? 0 : 1,
    );
  return Number(r.lastInsertRowid);
}

export function setupDb(): Db {
  return createTestDb();
}

export function deliveryId(db: Db, code: string): number {
  return (db.prepare('SELECT id FROM delivery_methods WHERE code = ?').get(code) as { id: number }).id;
}
export function paymentId(db: Db, code: string): number {
  return (db.prepare('SELECT id FROM payment_methods WHERE code = ?').get(code) as { id: number }).id;
}

/** Заказ в нужном статусе напрямую через репозиторий (мимо checkout). */
export function rawOrder(db: Db, status: OrderStatus, o: { owner?: OwnerRef; key?: string; paid?: boolean; now?: number } = {}): { id: number; number: string } {
  const created = ordersRepo.insert(db, {
    owner: o.owner ?? GUEST_A,
    status,
    contactName: 'Иван Иванов',
    contactEmail: 'ivan@example.test',
    contactPhone: '+7 900 111-22-33',
    phoneDigits: '79001112233',
    comment: null,
    address: null,
    delivery: { id: deliveryId(db, 'pickup'), code: 'pickup', name: 'Самовывоз', kind: 'pickup', kopecks: 0 },
    payment: { id: paymentId(db, 'cod'), code: 'cod', name: 'Оплата при получении', kind: 'cash_on_delivery' },
    subtotalKopecks: 100_000,
    discountKopecks: 0,
    totalKopecks: 100_000,
    promo: null,
    idempotencyKey: o.key ?? `key-${Math.random()}`,
    now: o.now ?? T0,
  });
  if (o.paid) db.prepare('UPDATE orders SET is_paid = 1 WHERE id = ?').run(created.id);
  return created;
}
