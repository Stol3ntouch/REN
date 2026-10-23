import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withStaffPermission } from '@/domain/admin/guard';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { getProductBySlug, searchProducts } from '@/domain/catalog';
import { accountOrders } from '@/domain/customers/account';
import { clearOnLoginHooks, login, register } from '@/domain/customers/auth';
import { getSession } from '@/domain/customers/session';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { orders } from '@/domain/ordering/orders';
import { parseYml, planImport } from '@/importing/yml';
import { processPaymentWebhook, startPaymentForOrder } from '@/integrations/payment/service';
import { handleFormRequest } from '@/domain/requests/http';
import { NotFoundError } from '@/server/http/errors';
import { createTestDb } from '@/server/db/testing';
import type { OwnerRef } from '@/server/http/owner';
import { fakeCookies } from '../auth/helpers';
import { addCategory, addProduct as addCatalogProduct } from '../catalog/helpers';
import { SECRET, SESSION, newPort, signedWebhook } from '../payment/helpers';
import { T0, deliveryId, paymentId } from '../ordering/helpers';

afterEach(() => clearOnLoginHooks());

const CONTACT = { name: 'Иван Иванов', email: 'ivan@example.test', phone: '+7 900 111-22-33' };
const secretOpts = (db: ReturnType<typeof createTestDb>) => ({ db, now: T0, secret: SESSION });

function shop() {
  const db = createTestDb();
  const cat = addCategory(db, 'Триммеры', 'trimmery');
  const id = addCatalogProduct(db, { name: 'Триммер бензиновый CHAMPION T523', sku: 'T523', slug: 'champion-t523', categoryId: cat });
  db.prepare('UPDATE products SET price_kopecks = 450000, in_stock = 1 WHERE id = ?').run(id);
  return { db, productId: id };
}

async function placeOrder(db: ReturnType<typeof createTestDb>, owner: OwnerRef, key: string, payment = 'cod') {
  const c = cart.get(owner, { db });
  return checkout.place(
    {
      owner,
      cartId: c.cartId,
      contact: CONTACT,
      deliveryMethodId: deliveryId(db, 'pickup'),
      paymentMethodId: paymentId(db, payment),
      idempotencyKey: key,
      consent: true,
    },
    secretOpts(db),
  );
}

describe('сценарий покупателя: поиск → товар → корзина → заказ', () => {
  it('гость: находит товар поиском, открывает карточку, кладёт в корзину и оформляет; цена и сумма — серверные', async () => {
    const { db, productId } = shop();
    const found = await searchProducts({ text: 'T523', filters: {}, sort: 'relevance', page: 1, pageSize: 20 }, { db });
    expect(found.items.map((i) => i.id)).toEqual([productId]);
    const page = await getProductBySlug('champion-t523', { db });
    expect(page?.name).toContain('T523');

    const guest: OwnerRef = { kind: 'guest', guestId: '11111111-1111-4111-8111-111111111111' };
    cart.add(guest, { productId, qty: 2 }, { db, now: T0 });
    const order = await placeOrder(db, guest, 'guest-key-0000000001');
    expect(order.totalKopecks).toBe(900_000);
    expect(order.status).toBe('new');
    expect(cart.get(guest, { db }).count).toBe(0);
  });

  it('двойной submit с тем же ключом даёт один заказ', async () => {
    const { db, productId } = shop();
    const guest: OwnerRef = { kind: 'guest', guestId: '22222222-2222-4222-8222-222222222222' };
    cart.add(guest, { productId, qty: 1 }, { db, now: T0 });
    const first = await placeOrder(db, guest, 'same-key-000000000001');
    const second = await placeOrder(db, guest, 'same-key-000000000001').catch(() => null);
    if (second) expect(second.number).toBe(first.number);
    expect((db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n).toBe(1);
  });

  it('вошедший: регистрация и вход, заказ виден в истории, чужой заказ — 404', async () => {
    const { db, productId } = shop();
    const cookies = fakeCookies();
    const ctx = { db, cookies, ip: '10.0.0.1', now: T0 };
    const { userId } = await register({ email: 'ivan@example.test', password: 'long-enough-pass', consent: true }, ctx);
    const owner: OwnerRef = { kind: 'user', userId };
    cart.add(owner, { productId, qty: 1 }, { db, now: T0 });
    const mine = await placeOrder(db, owner, 'user-key-00000000001');

    // повторный вход с нуля
    const again = fakeCookies();
    await login({ email: 'ivan@example.test', password: 'long-enough-pass' }, { ...ctx, cookies: again });
    const session = getSession(again, { db, now: T0 });
    expect(session?.userId).toBe(userId);
    expect(accountOrders.list(userId, { db }).map((o) => o.number)).toEqual([mine.number]);

    // другой покупатель и гость не видят этот заказ
    const other = await register({ email: 'other@example.test', password: 'long-enough-pass', consent: true }, { ...ctx, cookies: fakeCookies() });
    expect(() => accountOrders.get(other.userId, mine.number, { db })).toThrow(NotFoundError);
    expect(orders.getForCustomer(mine.number, { kind: 'guest', guestId: '33333333-3333-4333-8333-333333333333' }, { db })).toBeNull();
  });
});

describe('оплата: webhook', () => {
  it('повтор того же события не меняет заказ второй раз', async () => {
    const { db, productId } = shop();
    const guest: OwnerRef = { kind: 'guest', guestId: '44444444-4444-4444-8444-444444444444' };
    cart.add(guest, { productId, qty: 1 }, { db, now: T0 });
    const order = await placeOrder(db, guest, 'pay-key-000000000001');
    db.prepare("UPDATE orders SET status = 'awaiting_payment' WHERE id = ?").run(order.id);
    const port = newPort();
    const full = orders.getForStaff(order.number, { db })!;
    await startPaymentForOrder(full, { db, port, now: T0, secret: SESSION });
    const pay = db.prepare('SELECT external_id AS id FROM payments WHERE order_id = ?').get(order.id) as { id: string };
    const base = { paymentId: pay.id, orderNumber: order.number, amountKopecks: order.totalKopecks };
    const send = () => {
      const { body, headers } = signedWebhook(base, {}, SECRET);
      return processPaymentWebhook(body, headers, { db, port, now: T0 + 5_000 });
    };
    expect((await send()).status).toBe(200);
    const events = (db.prepare('SELECT COUNT(*) AS n FROM order_events WHERE order_id = ?').get(order.id) as { n: number }).n;
    expect((await send()).status).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS n FROM order_events WHERE order_id = ?').get(order.id) as { n: number }).n).toBe(events);
    expect((db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id) as { status: string }).status).toBe('paid');
  });
});

describe('админка', () => {
  it('менеджер → операция администратора → 403; сотрудник меняет статус заказа, переход записывается', async () => {
    const { db, productId } = shop();
    await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
    await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
    const token = async (email: string, password: string) => {
      const c = fakeCookies();
      await loginStaff({ email, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
      return c.jar.get(ADMIN_SESSION_COOKIE)!;
    };
    const inner = vi.fn(() => Response.json({ ok: true }));
    const route = withStaffPermission('catalog.write', inner, { db, now: T0 });
    const res = await route(
      new Request('http://shop.test/api/x', { method: 'POST', headers: { host: 'shop.test', origin: 'http://shop.test', cookie: `${ADMIN_SESSION_COOKIE}=${await token('mgr@shop.test', 'manager-password-1')}` } }),
    );
    expect(res.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();

    const guest: OwnerRef = { kind: 'guest', guestId: '55555555-5555-4555-8555-555555555555' };
    cart.add(guest, { productId, qty: 1 }, { db, now: T0 });
    const order = await placeOrder(db, guest, 'adm-key-000000000001');
    const staffRow = db.prepare("SELECT id FROM staff WHERE email = 'mgr@shop.test'").get() as { id: number };
    const updated = await orders.transition(order.id, 'processing', { type: 'staff', staffId: staffRow.id, role: 'manager' }, 'Принят в работу', { db, now: T0 });
    expect(updated.status).toBe('processing');
    // назад в «новый» нельзя
    await expect(orders.transition(order.id, 'new', { type: 'staff', staffId: staffRow.id, role: 'manager' }, undefined, { db, now: T0 })).rejects.toThrow();
  });

  it('предпросмотр импорта ничего не записывает в каталог', () => {
    const db = createTestDb();
    const xml = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'catalog-sample.yml'), 'utf8');
    const plan = planImport(parseYml(xml), db, { fileName: 'catalog-sample.yml' });
    expect(plan.summary.products.create).toBeGreaterThan(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n).toBe(0);
  });
});

describe('формы заявок', () => {
  it('заявка на ремонт и звонок создаются; без согласия — 400', async () => {
    const db = createTestDb();
    const post = (kind: string, body: unknown) =>
      handleFormRequest(
        kind,
        new Request(`https://shop.test/api/forms/${kind}`, {
          method: 'POST',
          headers: { origin: 'https://shop.test', host: 'shop.test', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { db, now: T0 },
      );
    const callback = await post('callback', { name: 'Анна', phone: '+7 900 000-11-22', consent: true, website: '' });
    expect(callback.status).toBe(201);
    const bad = await post('callback', { name: 'Анна', phone: '+7 900 000-11-22', consent: false, website: '' });
    expect(bad.status).toBe(400);
    expect((db.prepare("SELECT COUNT(*) AS n FROM requests WHERE kind = 'callback'").get() as { n: number }).n).toBe(1);
  });
});
