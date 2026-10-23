import { afterEach, describe, expect, it } from 'vitest';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { methodsRepo } from '@/server/db/repositories/methods';
import type { Db } from '@/server/db/connection';
import { GUEST_A, T0, addProduct, paymentId, deliveryId, setupDb } from '../ordering/helpers';

const env = process.env as Record<string, string | undefined>;
const saved = { APP_ENV: env.APP_ENV, NODE_ENV: env.NODE_ENV, PAYMENT_PROVIDER: env.PAYMENT_PROVIDER };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

const opts = (db: Db) => ({ db, now: T0, secret: 'x'.repeat(40) });
const codes = (db: Db) => checkout.methods(opts(db)).payment.map((m) => m.code);

function dbWithOnlineTest(): Db {
  const db = setupDb();
  methodsRepo.insertOnlineTestIfMissing(db);
  methodsRepo.setPaymentEnabled(db, 'online_test', true);
  return db;
}

function placeInput(db: Db) {
  const productId = addProduct(db);
  const view = cart.add(GUEST_A, { productId, qty: 1 }, opts(db));
  return {
    owner: GUEST_A,
    cartId: view.cartId,
    contact: { name: 'Иван Иванов', email: 'ivan@example.test', phone: '+7 900 111-22-33' },
    deliveryMethodId: deliveryId(db, 'pickup'),
    paymentMethodId: paymentId(db, 'online_test'),
    idempotencyKey: 'k'.repeat(24),
    consent: true,
  };
}

describe('checkout: «онлайн (ТЕСТ)» и production (одно определение production)', () => {
  it('вне production и с тестовым провайдером метод предлагается и принимается', async () => {
    env.NODE_ENV = 'test';
    delete env.APP_ENV;
    delete env.PAYMENT_PROVIDER;
    const db = dbWithOnlineTest();
    expect(codes(db)).toContain('online_test');
    expect((await checkout.place(placeInput(db), opts(db))).payment.code).toBe('online_test');
  });

  it('APP_ENV=production (без NODE_ENV=production): метод скрыт и отклоняется, даже если enabled=1', async () => {
    env.NODE_ENV = 'test';
    env.APP_ENV = 'production';
    const db = dbWithOnlineTest();
    expect(codes(db)).toEqual(['cod']);
    await expect(checkout.place(placeInput(db), opts(db))).rejects.toMatchObject({ status: 400 });
  });

  it('порт «none» (провайдер не выбран): online-метод скрыт и отклоняется', async () => {
    env.NODE_ENV = 'test';
    delete env.APP_ENV;
    env.PAYMENT_PROVIDER = 'nonexistent';
    const db = dbWithOnlineTest();
    expect(codes(db)).toEqual(['cod']);
    await expect(checkout.place(placeInput(db), opts(db))).rejects.toMatchObject({ status: 400 });
  });
});
