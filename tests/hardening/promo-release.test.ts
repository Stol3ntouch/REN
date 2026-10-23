import { describe, expect, it } from 'vitest';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { orders } from '@/domain/ordering/orders';
import type { Actor } from '@/domain/ordering/types';
import type { Db } from '@/server/db/connection';
import { GUEST_A, T0, addProduct, deliveryId, paymentId, setupDb } from '../ordering/helpers';

const ADMIN: Actor = { type: 'staff', staffId: 1, role: 'admin' };
const SYSTEM: Actor = { type: 'system', reason: 'test' };
const opts = (db: Db) => ({ db, now: T0, secret: 'x'.repeat(40) });

function setup(usageLimit: number | null = 1) {
  const db = setupDb();
  db.prepare("INSERT INTO promos (code, type, value, usage_limit, created_at, updated_at) VALUES ('ONCE', 'fixed', 10000, ?, 1, 1)").run(usageLimit);
  const productId = addProduct(db, { price: 500_000 });
  const used = () => (db.prepare("SELECT used_count FROM promos WHERE code = 'ONCE'").get() as { used_count: number }).used_count;
  const place = async () => {
    cart.add(GUEST_A, { productId, qty: 1 }, { db, now: T0 });
    await cart.applyPromo(GUEST_A, 'ONCE', { db, now: T0 });
    return checkout.place(
      {
        owner: GUEST_A,
        cartId: cart.get(GUEST_A, { db }).cartId,
        contact: { name: 'Иван Иванов', email: 'ivan@example.test', phone: '+7 (900) 111-22-33' },
        deliveryMethodId: deliveryId(db, 'pickup'),
        paymentMethodId: paymentId(db, 'cod'),
        idempotencyKey: `key-${Math.random().toString(36).slice(2)}-abcdefgh`,
        consent: true,
      },
      opts(db),
    );
  };
  return { db, place, used };
}

describe('промокод возвращается при отмене заказа', () => {
  it('отмена возвращает использование; повторная отмена не уводит счётчик ниже', async () => {
    const { db, place, used } = setup(null);
    const order = await place();
    expect(order.promoCode).toBe('ONCE');
    expect(used()).toBe(1);
    await orders.transition(order.id, 'cancelled', ADMIN, undefined, opts(db));
    expect(used()).toBe(0);
    // cancelled — конечный статус: вторая отмена отклонена, возврат не повторяется
    await expect(orders.transition(order.id, 'cancelled', ADMIN, undefined, opts(db))).rejects.toThrow();
    expect(used()).toBe(0);
  });

  it('признак «возвращён» не даёт вернуть дважды, даже если статус вернули вручную', async () => {
    const { db, place, used } = setup(null);
    const a = await place();
    const b = await place();
    expect(used()).toBe(2);
    await orders.transition(a.id, 'cancelled', ADMIN, undefined, opts(db));
    expect(used()).toBe(1);
    // имитация сбоя/ручной правки: заказ снова «новый» и отменяется ещё раз
    db.prepare("UPDATE orders SET status = 'new' WHERE id = ?").run(a.id);
    await orders.transition(a.id, 'cancelled', ADMIN, undefined, opts(db));
    expect(used()).toBe(1);
    expect(b.promoCode).toBe('ONCE');
  });

  it('повторный place после отмены снова занимает освободившийся лимит', async () => {
    const { db, place, used } = setup(1);
    const first = await place();
    // лимит 1 исчерпан: промокод к следующей корзине не применяется
    expect((await place()).promoCode).toBeNull();
    expect(used()).toBe(1);
    await orders.transition(first.id, 'cancelled', ADMIN, undefined, opts(db));
    expect(used()).toBe(0);
    const again = await place();
    expect(again.promoCode).toBe('ONCE');
    expect(used()).toBe(1);
  });

  it('payment_failed → cancelled тоже возвращает', async () => {
    const { db, place, used } = setup(null);
    const order = await place();
    db.prepare("UPDATE orders SET status = 'payment_failed' WHERE id = ?").run(order.id);
    await orders.transition(order.id, 'cancelled', SYSTEM, undefined, opts(db));
    expect(used()).toBe(0);
  });

  it('возврат денег до исполнения возвращает промокод, после отгрузки — нет', async () => {
    const { db, place, used } = setup(null);
    const early = await place();
    db.prepare("UPDATE orders SET status = 'processing', is_paid = 1 WHERE id = ?").run(early.id);
    await orders.transition(early.id, 'refunded', SYSTEM, undefined, opts(db));
    expect(used()).toBe(1 - 1);

    const late = await place();
    expect(used()).toBe(1);
    db.prepare("UPDATE orders SET status = 'delivered', is_paid = 1 WHERE id = ?").run(late.id);
    await orders.transition(late.id, 'refunded', SYSTEM, undefined, opts(db));
    expect(used()).toBe(1);
  });

  it('заказ без промокода и счётчик 0 не меняют данные', async () => {
    const { db, used } = setup(null);
    const productId = addProduct(db, { price: 100_000 });
    cart.add(GUEST_A, { productId, qty: 1 }, { db, now: T0 });
    const order = await checkout.place(
      {
        owner: GUEST_A,
        cartId: cart.get(GUEST_A, { db }).cartId,
        contact: { name: 'Иван Иванов', email: 'ivan@example.test', phone: '+7 (900) 111-22-33' },
        deliveryMethodId: deliveryId(db, 'pickup'),
        paymentMethodId: paymentId(db, 'cod'),
        idempotencyKey: 'plain-order-key-abcdefgh',
        consent: true,
      },
      opts(db),
    );
    await orders.transition(order.id, 'cancelled', ADMIN, undefined, opts(db));
    expect(used()).toBe(0);
  });
});
