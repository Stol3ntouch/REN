import { describe, expect, it } from 'vitest';
import { createNotificationsGetHandler, createNotificationsPostHandler } from '@/app/admin/api/notifications/handler';
import { notify } from '@/domain/admin/notifications';
import { FEED_PAGE_SIZE, notificationsFeed, parseFeedFilter } from '@/domain/admin/notifications-feed';
import type { StaffSession } from '@/domain/admin/permissions';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';
import { req, staffCookies, T0 } from '../analytics/staff-cookies';
import { GUEST_A, addProduct, deliveryId, paymentId } from '../ordering/helpers';

const MIN = 60_000;
const session = (staffId: number, role: 'admin' | 'manager', permissions?: StaffSession['permissions']): StaffSession => ({
  staffId,
  email: 'x@x.test',
  name: null,
  role,
  ...(permissions ? { permissions } : {}),
});

async function setup() {
  const db = createTestDb();
  const c = await staffCookies(db);
  const o = { db, now: T0 };
  return { db, o, c, admin: session(c.adminId, 'admin'), manager: session(c.managerId, 'manager') };
}

describe('лента уведомлений', () => {
  it('на пустой базе — пусто, без демонстрационных записей', async () => {
    const { o, manager } = await setup();
    expect(notificationsFeed.summary(manager, o)).toEqual({ unread: 0, latest: [] });
    expect(notificationsFeed.page(manager, parseFeedFilter({}), o)).toMatchObject({ items: [], total: 0, unread: 0, pages: 1, types: [] });
  });

  it('фильтры: прочитанные / непрочитанные / тип; страницы; отметка прочитанным и «все»', async () => {
    const { o, manager } = await setup();
    for (let i = 0; i < FEED_PAGE_SIZE + 3; i++) {
      notify({ type: i % 2 ? 'order.created' : 'request.created', title: `N${i}`, entity: 'x', entityId: i }, { ...o, now: T0 + i * MIN });
    }
    const p1 = notificationsFeed.page(manager, parseFeedFilter({}), o);
    expect(p1.items).toHaveLength(FEED_PAGE_SIZE);
    expect(p1.total).toBe(FEED_PAGE_SIZE + 3);
    expect(p1.pages).toBe(2);
    expect(p1.types.map((t) => t.label).sort()).toEqual(['Новое обращение или заявка', 'Новый заказ']);
    expect(notificationsFeed.page(manager, parseFeedFilter({ page: '2' }), o).items).toHaveLength(3);

    const target = p1.items[0]!;
    expect(notificationsFeed.markRead(manager, target.id, o)).toEqual({ ok: true, unread: FEED_PAGE_SIZE + 2 });
    expect(notificationsFeed.page(manager, parseFeedFilter({ state: 'read' }), o).items.map((n) => n.id)).toEqual([target.id]);
    expect(notificationsFeed.page(manager, parseFeedFilter({ state: 'unread' }), o).total).toBe(FEED_PAGE_SIZE + 2);
    const orders = notificationsFeed.page(manager, parseFeedFilter({ type: 'order.created' }), o);
    expect(orders.items.every((n) => n.type === 'order.created')).toBe(true);
    expect(notificationsFeed.markAllRead(manager, o)).toEqual({ marked: FEED_PAGE_SIZE + 2, unread: 0 });
  });

  it('права: без notifications.read → 403; аноним → 401; по audience менеджер не видит чужого', async () => {
    const { o, admin, manager } = await setup();
    notify({ type: 'import.failed', title: 'Импорт упал', audience: 'permission:import.run' }, o);
    notify({ type: 'order.created', title: 'Заказ', audience: 'permission:orders.read' }, o);
    expect(notificationsFeed.summary(admin, o).unread).toBe(2);
    expect(notificationsFeed.summary(manager, o).latest.map((n) => n.title)).toEqual(['Заказ']);
    expect(() => notificationsFeed.summary(session(manager.staffId, 'manager', ['staff.self']), o)).toThrow(ForbiddenError);
    expect(() => notificationsFeed.summary(null, o)).toThrow(UnauthorizedError);
  });

  it('фильтр из адресной строки: мусор отбрасывается', () => {
    expect(parseFeedFilter({ state: 'x', type: 'DROP TABLE', page: '-3' })).toEqual({ state: 'all', type: null, page: 1 });
    expect(parseFeedFilter({ state: ['unread'], type: 'order.created', page: '4' })).toEqual({ state: 'unread', type: 'order.created', page: 4 });
  });
});

describe('источники', () => {
  it('новый заказ при оформлении создаёт одно уведомление для orders.read со ссылкой на заказ', async () => {
    const { db, o, manager } = await setup();
    const owner = GUEST_A;
    const p = addProduct(db, { name: 'Бензопила', price: 500_000 });
    cart.add(owner, { productId: p, qty: 1 }, { db, now: T0 });
    const order = await checkout.place(
      {
        owner,
        cartId: cart.get(owner, { db }).cartId,
        contact: { name: 'Иван', email: 'i@x.test', phone: '+7 (900) 111-22-33' },
        deliveryMethodId: deliveryId(db, 'pickup'),
        paymentMethodId: paymentId(db, 'cod'),
        idempotencyKey: 'order-notify-key-1',
        consent: true,
      },
      { db, now: T0, secret: 'x'.repeat(40) },
    );
    const list = notificationsFeed.summary(manager, o).latest;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'order.created', href: `/admin/orders/${order.number}`, severity: 'info' });
  });
});

describe('обработчики /admin/api/notifications', () => {
  it('GET: 401 без входа; счётчик и список; POST: прочитано, «все», неверное тело → 400, чужой Origin → 403', async () => {
    const { db, c } = await setup();
    const a = notify({ type: 'order.created', title: 'Заказ 1', entity: 'order', entityId: '1', audience: 'permission:orders.read' }, { db, now: T0 });
    notify({ type: 'order.created', title: 'Заказ 2', entity: 'order', entityId: '2', audience: 'permission:orders.read' }, { db, now: T0 + MIN });
    const get = createNotificationsGetHandler({ db, now: T0 });
    const post = createNotificationsPostHandler({ db, now: T0 });
    const url = 'http://shop.test/admin/api/notifications';
    expect((await get(req(url))).status).toBe(401);
    const body = await (await get(req(url, { cookie: c.manager }))).json();
    expect(body.unread).toBe(2);
    expect(body.latest.map((n: { title: string }) => n.title)).toEqual(['Заказ 2', 'Заказ 1']);

    expect(await (await post(req(url, { cookie: c.manager, method: 'POST', body: { id: a.id } }))).json()).toEqual({ ok: true, unread: 1 });
    expect((await post(req(url, { cookie: c.manager, method: 'POST', body: { id: 'x' } }))).status).toBe(400);
    expect(await (await post(req(url, { cookie: c.manager, method: 'POST', body: { all: true } }))).json()).toEqual({ marked: 1, unread: 0 });
    const evil = new Request(url, { method: 'POST', headers: { host: 'shop.test', origin: 'http://evil.test', cookie: c.manager, 'content-type': 'application/json' }, body: '{"all":true}' });
    expect((await post(evil)).status).toBe(403);
  });
});
