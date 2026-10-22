import { describe, expect, it } from 'vitest';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { reorder } from '@/domain/ordering/reorder';
import { GUEST_A, GUEST_B, T0, addProduct, deliveryId, paymentId, setupDb } from './helpers';

describe('reorder: «повторить заказ» (для кабинета T07)', () => {
  async function setup() {
    const db = setupDb();
    const a = addProduct(db, { name: 'Пила', price: 100_000 });
    const b = addProduct(db, { name: 'Масло', price: 20_000 });
    cart.add(GUEST_A, { productId: a, qty: 2 }, { db, now: T0 });
    cart.add(GUEST_A, { productId: b, qty: 1 }, { db, now: T0 });
    const order = await checkout.place(
      {
        owner: GUEST_A,
        cartId: cart.get(GUEST_A, { db }).cartId,
        contact: { name: 'Анна', email: 'a@example.test', phone: '+7 900 000-00-00' },
        deliveryMethodId: deliveryId(db, 'pickup'),
        paymentMethodId: paymentId(db, 'cod'),
        idempotencyKey: 'reorder-key-0123456789',
        consent: true,
      },
      { db, now: T0 },
    );
    return { db, a, b, order };
  }

  it('кладёт в корзину те же товары и количества по ТЕКУЩИМ ценам', async () => {
    const { db, a, b, order } = await setup();
    db.prepare('UPDATE products SET price_kopecks = 150_000 WHERE id = ?').run(a);
    const res = reorder(order.number, GUEST_A, { db, now: T0 });
    expect(res.added).toBe(2);
    expect(res.skipped).toEqual([]);
    expect(res.cart.items.map((i) => [i.productId, i.qty, i.unitKopecks])).toEqual([
      [a, 2, 150_000],
      [b, 1, 20_000],
    ]);
  });

  it('недоступные и снятые товары пропускаются с пояснением, остальные добавляются', async () => {
    const { db, a, b, order } = await setup();
    db.prepare('UPDATE products SET in_stock = 0 WHERE id = ?').run(a);
    const res = reorder(order.number, GUEST_A, { db, now: T0 });
    expect(res.added).toBe(1);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]).toMatchObject({ name: 'Пила' });
    expect(res.skipped[0]!.reason).toMatch(/наличии/);
    expect(res.cart.items.map((i) => i.productId)).toEqual([b]);
  });

  it('чужой заказ повторить нельзя: 404, корзина не меняется', async () => {
    const { db, order } = await setup();
    expect(() => reorder(order.number, GUEST_B, { db, now: T0 })).toThrowError(expect.objectContaining({ status: 404 }));
    expect(cart.get(GUEST_B, { db }).items).toHaveLength(0);
  });
});
