import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { orderOps, parseOrderFilters } from '@/domain/ordering/admin-ops';
import { ordersRepo, type OrderStatus } from '@/server/db/repositories/orders';
import type { Db } from '@/server/db/connection';
import { addProduct, deliveryId, paymentId, rawOrder, setupDb, T0 } from './helpers';

const ADMIN: StaffSession = { staffId: 1, email: 'boss@x.test', name: 'Босс', role: 'admin' };
const MANAGER: StaffSession = { staffId: 2, email: 'mgr@x.test', name: 'Менеджер', role: 'manager' };
const SERVICE: StaffSession = { staffId: 3, email: 'srv@x.test', name: 'Сервис', role: 'service' };

function withStaff() {
  const db = setupDb();
  db.prepare(
    "INSERT INTO staff (id, email, name, role_id, password_hash, created_at) VALUES (1, 'boss@x.test', 'Босс', (SELECT id FROM roles WHERE code = 'admin'), 'x', 1), (2, 'mgr@x.test', 'Менеджер', (SELECT id FROM roles WHERE code = 'manager'), 'x', 1), (3, 'srv@x.test', 'Сервис', (SELECT id FROM roles WHERE code = 'service'), 'x', 1)",
  ).run();
  return db;
}

/** Заказ со строками «как при оформлении»: цены — снимок, итоги согласованы. */
function orderWith(db: Db, lines: Array<{ productId: number; name: string; unit: number; qty: number }>, status: OrderStatus = 'new', over: { discount?: number; promoId?: number } = {}) {
  const o = rawOrder(db, status);
  const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  for (const l of lines) {
    ordersRepo.insertItem(db, o.id, { productId: l.productId, name: l.name, sku: `S-${l.productId}`, priceKopecks: l.unit, discountPriceKopecks: null, unitKopecks: l.unit, qty: l.qty, lineKopecks: l.unit * l.qty });
  }
  db.prepare('UPDATE orders SET subtotal_kopecks = ?, discount_kopecks = ?, total_kopecks = ? WHERE id = ?').run(subtotal, over.discount ?? 0, subtotal - (over.discount ?? 0), o.id);
  return o;
}

describe('правка данных заказа до отгрузки', () => {
  it('контакты, адрес и комментарий клиента меняются; событие и аудит без значений ПДн', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'confirmed');
    const res = await orderOps.updateDetails(MANAGER, o.id, { name: 'Пётр Петров', phone: '+7 900 555-44-33', email: 'Petr@Example.test', address: 'г. Тула, ул. Мира, 5', comment: 'после 18:00' }, { db, now: T0 });
    expect(res.contact).toMatchObject({ name: 'Пётр Петров', phone: '+7 900 555-44-33', email: 'petr@example.test', address: 'г. Тула, ул. Мира, 5', comment: 'после 18:00' });
    const row = ordersRepo.findById(db, o.id)!;
    expect(row.contactEmail).toBe('petr@example.test');
    expect(db.prepare('SELECT phone_digits AS d, contact_name_lc AS n FROM orders WHERE id = ?').get(o.id)).toEqual({ d: '79005554433', n: 'пётр петров' });
    const ev = ordersRepo.listEvents(db, o.id).at(-1)!;
    expect(ev.kind).toBe('edit');
    expect(ev.note).toContain('имя');
    expect(ev.note).not.toContain('Пётр');
    const log = JSON.stringify(audit.list({ entity: 'order' }, { db }));
    expect(log).not.toContain('Пётр');
    expect(log).not.toContain('petr@example.test');
    expect(log).not.toContain('900 555');
  });

  it('проверка формата: плохой телефон/email → 400; пустое имя → 400; ничего не меняется', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'new');
    await expect(orderOps.updateDetails(MANAGER, o.id, { phone: '123' }, { db })).rejects.toMatchObject({ status: 400 });
    await expect(orderOps.updateDetails(MANAGER, o.id, { email: 'не-почта' }, { db })).rejects.toMatchObject({ status: 400 });
    await expect(orderOps.updateDetails(MANAGER, o.id, { name: ' ' }, { db })).rejects.toMatchObject({ status: 400 });
    await expect(orderOps.updateDetails(MANAGER, o.id, {}, { db })).rejects.toMatchObject({ status: 400 });
    expect(ordersRepo.findById(db, o.id)!.contactName).toBe('Иван Иванов');
  });

  it('выполненный/отменённый/возвращённый заказ править нельзя (409)', async () => {
    const db = withStaff();
    for (const s of ['delivered', 'cancelled', 'refunded'] as OrderStatus[]) {
      const o = rawOrder(db, s);
      await expect(orderOps.updateDetails(MANAGER, o.id, { name: 'Другой' }, { db })).rejects.toMatchObject({ status: 409 });
    }
  });

  it('адрес доставки обязателен, если способ получения требует адрес', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'new');
    db.prepare("UPDATE orders SET delivery_code = 'manual', delivery_kind = 'manual', delivery_method_id = ?, address = 'г. Тула, ул. Мира, 5' WHERE id = ?").run(deliveryId(db, 'manual'), o.id);
    await expect(orderOps.updateDetails(MANAGER, o.id, { address: '' }, { db })).rejects.toMatchObject({ status: 400 });
  });
});

describe('изменение состава: серверный пересчёт по снимкам цен', () => {
  it('уменьшение количества, удаление и добавление товара; итог считает сервер, цены прежних строк — снимок', async () => {
    const db = withStaff();
    const a = addProduct(db, { name: 'Триммер', price: 500_000 });
    const b = addProduct(db, { name: 'Леска', price: 30_000 });
    const c = addProduct(db, { name: 'Масло', price: 20_000 });
    const o = orderWith(db, [
      { productId: a, name: 'Триммер', unit: 450_000, qty: 2 }, // купили по 4 500 ₽, сейчас каталог дороже
      { productId: b, name: 'Леска', unit: 30_000, qty: 1 },
    ]);
    const items = ordersRepo.listItems(db, o.id);
    const res = await orderOps.editItems(
      MANAGER,
      o.id,
      { lines: [{ itemId: items[0]!.id, qty: 1 }, { itemId: items[1]!.id, qty: 0 }, { productId: c, qty: 3 }], reason: 'клиент изменил заказ по телефону' },
      { db, now: T0 },
    );
    expect(res.items.map((i) => [i.name, i.qty, i.unitKopecks, i.lineKopecks])).toEqual([
      ['Триммер', 1, 450_000, 450_000], // цена из снимка, не из каталога
      ['Масло', 3, 20_000, 60_000], // новая строка — текущая цена
    ]);
    expect(res.subtotalKopecks).toBe(510_000);
    expect(res.totalKopecks).toBe(510_000);
    const ev = ordersRepo.listEvents(db, o.id).at(-1)!;
    expect(ev.kind).toBe('items');
    expect(ev.note).toContain('клиент изменил заказ по телефону');
    expect(audit.list({ entity: 'order' }, { db }).map((l) => l.action)).toContain('order.items');
  });

  it('купон пересчитывается (процент от нового состава); доставка сохраняется; итог — целые копейки', async () => {
    const db = withStaff();
    const a = addProduct(db, { price: 10_000 });
    db.prepare("INSERT INTO promos (code, type, value, created_at, updated_at, used_count) VALUES ('AUTUMN10', 'percent', 10, 1, 1, 1)").run();
    const promoId = (db.prepare("SELECT id FROM promos WHERE code = 'AUTUMN10'").get() as { id: number }).id;
    const o = orderWith(db, [{ productId: a, name: 'Товар', unit: 9_999, qty: 3 }], 'new', { discount: 3_000, promoId });
    db.prepare("UPDATE orders SET promo_id = ?, promo_code = 'AUTUMN10', delivery_kopecks = 25_000 WHERE id = ?").run(promoId, o.id);
    const item = ordersRepo.listItems(db, o.id)[0]!;
    const res = await orderOps.editItems(MANAGER, o.id, { lines: [{ itemId: item.id, qty: 2 }], reason: 'меньше' }, { db, now: T0 });
    expect(res.subtotalKopecks).toBe(19_998);
    expect(res.discountKopecks).toBe(1_999); // floor(19998 * 10 / 100)
    expect(Number.isInteger(res.totalKopecks)).toBe(true);
    expect(res.totalKopecks).toBe(19_998 - 1_999 + 25_000);
  });

  it('запрещено: после «Передан в доставку», для оплаченного, пустой состав, без причины, лишнее количество, недоступный товар', async () => {
    const db = withStaff();
    const a = addProduct(db, { price: 10_000 });
    const gone = addProduct(db, { price: 10_000, inStock: false });
    const hidden = addProduct(db, { price: 10_000, published: false });
    const o = orderWith(db, [{ productId: a, name: 'Товар', unit: 10_000, qty: 1 }]);
    const item = ordersRepo.listItems(db, o.id)[0]!;
    const edit = (lines: Array<{ itemId?: number; productId?: number; qty: number }>, reason = 'правка') => orderOps.editItems(MANAGER, o.id, { lines, reason }, { db, now: T0 });

    await expect(edit([{ itemId: item.id, qty: 0 }])).rejects.toMatchObject({ status: 400 }); // пустой состав
    await expect(edit([{ itemId: item.id, qty: 2 }], ' ')).rejects.toMatchObject({ status: 400 }); // нет причины
    await expect(edit([{ itemId: item.id, qty: 21 }])).rejects.toMatchObject({ status: 400 });
    await expect(edit([{ itemId: item.id, qty: 1 }, { productId: gone, qty: 1 }])).rejects.toMatchObject({ status: 409 });
    await expect(edit([{ itemId: item.id, qty: 1 }, { productId: hidden, qty: 1 }])).rejects.toMatchObject({ status: 409 });
    await expect(edit([{ itemId: item.id, qty: 1 }, { productId: a, qty: 1 }])).rejects.toMatchObject({ status: 400 }); // дубль товара
    await expect(edit([{ itemId: 999_999, qty: 1 }])).rejects.toMatchObject({ status: 404 }); // чужая строка
    expect(ordersRepo.listItems(db, o.id)).toHaveLength(1);

    const paid = orderWith(db, [{ productId: a, name: 'Товар', unit: 10_000, qty: 1 }], 'processing');
    db.prepare('UPDATE orders SET is_paid = 1 WHERE id = ?').run(paid.id);
    const pi = ordersRepo.listItems(db, paid.id)[0]!;
    await expect(orderOps.editItems(MANAGER, paid.id, { lines: [{ itemId: pi.id, qty: 2 }], reason: 'x' }, { db })).rejects.toMatchObject({ status: 409 });

    for (const s of ['shipped', 'ready_for_pickup', 'delivered', 'cancelled'] as OrderStatus[]) {
      const late = orderWith(db, [{ productId: a, name: 'Товар', unit: 10_000, qty: 1 }], s);
      const li = ordersRepo.listItems(db, late.id)[0]!;
      await expect(orderOps.editItems(MANAGER, late.id, { lines: [{ itemId: li.id, qty: 2 }], reason: 'x' }, { db })).rejects.toMatchObject({ status: 409 });
    }
  });

  it('строка другого заказа (IDOR по itemId) → 404, заказ не меняется', async () => {
    const db = withStaff();
    const a = addProduct(db, { price: 10_000 });
    const mine = orderWith(db, [{ productId: a, name: 'Товар', unit: 10_000, qty: 1 }]);
    const other = orderWith(db, [{ productId: a, name: 'Чужой', unit: 10_000, qty: 5 }]);
    const foreign = ordersRepo.listItems(db, other.id)[0]!;
    await expect(orderOps.editItems(MANAGER, mine.id, { lines: [{ itemId: foreign.id, qty: 1 }], reason: 'x' }, { db })).rejects.toMatchObject({ status: 404 });
    expect(ordersRepo.listItems(db, other.id)[0]!.qty).toBe(5);
  });
});

describe('внутренние комментарии', () => {
  it('отдельные записи с автором и временем; покупателю не видны', () => {
    const db = withStaff();
    const o = rawOrder(db, 'new');
    orderOps.addComment(MANAGER, o.id, 'позвонил, не отвечает', { db, now: T0 });
    orderOps.addComment(ADMIN, o.id, 'перезвонить завтра', { db, now: T0 + 60_000 });
    const list = orderOps.comments(MANAGER, o.id, { db });
    expect(list.map((c) => [c.authorName, c.body, c.createdAt])).toEqual([
      ['Менеджер', 'позвонил, не отвечает', T0],
      ['Босс', 'перезвонить завтра', T0 + 60_000],
    ]);
    expect(() => orderOps.addComment(MANAGER, o.id, '   ', { db })).toThrow();
    expect(() => orderOps.comments(null, o.id, { db })).toThrow();
    expect(() => orderOps.comments(SERVICE, o.id, { db })).not.toThrow(); // orders.read есть
  });
});

describe('список заказов: фильтры, сортировка, страницы', () => {
  function seed() {
    const db = withStaff();
    const mk = (status: OrderStatus, total: number, name: string, phone: string, extra: { delivery?: string; payment?: string; paid?: boolean; at?: number; staff?: number | null } = {}) => {
      const o = rawOrder(db, status, { paid: extra.paid, now: extra.at ?? T0 });
      db.prepare('UPDATE orders SET total_kopecks = ?, subtotal_kopecks = ?, contact_name = ?, contact_name_lc = ?, phone_digits = ?, contact_phone = ?, assigned_staff_id = ? WHERE id = ?').run(
        total, total, name, name.toLowerCase(), phone.replace(/\D/g, ''), phone, extra.staff ?? null, o.id,
      );
      if (extra.delivery === 'manual') db.prepare("UPDATE orders SET delivery_code = 'manual', delivery_method_id = ? WHERE id = ?").run(deliveryId(db, 'manual'), o.id);
      if (extra.payment === 'online') db.prepare("UPDATE orders SET payment_code = 'test', payment_kind = 'online', payment_method_id = ? WHERE id = ?").run(paymentId(db, 'cod'), o.id);
      return o;
    };
    const a = mk('new', 100_000, 'Анна', '+7 900 111-11-11', { at: T0 });
    const b = mk('confirmed', 300_000, 'Борис', '+7 900 222-22-22', { at: T0 + 1000, staff: 2, delivery: 'manual' });
    const c = mk('delivered', 200_000, 'Вера', '+7 900 333-33-33', { at: T0 + 2000, paid: true, staff: 2 });
    const d = mk('awaiting_payment', 50_000, 'Глеб', '+7 900 444-44-44', { at: T0 + 3000, payment: 'online' });
    return { db, a, b, c, d };
  }
  const nums = (r: { rows: Array<{ number: string }> }) => r.rows.map((x) => x.number);

  it('поиск: номер, имя, телефон, email; статус; оплата; доставка; способ оплаты; ответственный; сумма; период', () => {
    const { db, a, b, c, d } = seed();
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ q: 'Борис' }), { db }))).toEqual([b.number]);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ q: '333-33' }), { db }))).toEqual([c.number]);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ q: a.number }), { db }))).toEqual([a.number]);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ status: 'confirmed' }), { db }))).toEqual([b.number]);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ pay: 'paid' }), { db }))).toEqual([c.number]);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ pay: 'unpaid' }), { db })).sort()).toEqual([a.number, b.number, d.number].sort());
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ delivery: 'manual' }), { db }))).toEqual([b.number]);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ method: 'test' }), { db }))).toEqual([d.number]);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ assigned: '2' }), { db })).sort()).toEqual([b.number, c.number].sort());
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ min: '1500', max: '2500' }), { db }))).toEqual([c.number]); // рубли → копейки
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ from: '2026-10-22', to: '2026-10-22' }), { db }))).toHaveLength(4);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ from: '2026-10-23' }), { db }))).toHaveLength(0);
  });

  it('сортировка по сумме и дате, направление; сортировка вне белого списка игнорируется', () => {
    const { db, a, b, c, d } = seed();
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ sort: 'total', dir: 'desc' }), { db }))).toEqual([b.number, c.number, a.number, d.number]);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ sort: 'total', dir: 'asc' }), { db }))).toEqual([d.number, a.number, c.number, b.number]);
    expect(nums(orderOps.list(MANAGER, parseOrderFilters({ sort: 'created', dir: 'asc' }), { db }))).toEqual([a.number, b.number, c.number, d.number]);
    expect(() => orderOps.list(MANAGER, parseOrderFilters({ sort: 'id; DROP TABLE orders' }), { db })).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS c FROM orders').get()).toEqual({ c: 4 });
  });

  it('пагинация 20/50/100: размер вне списка заменяется на 20; общее число не зависит от страницы', () => {
    const db = withStaff();
    for (let i = 0; i < 55; i += 1) rawOrder(db, 'new');
    const p1 = orderOps.list(MANAGER, parseOrderFilters({}), { db });
    expect([p1.pageSize, p1.rows.length, p1.total]).toEqual([20, 20, 55]);
    expect(orderOps.list(MANAGER, parseOrderFilters({ pageSize: '50', page: '2' }), { db }).rows).toHaveLength(5);
    expect(orderOps.list(MANAGER, parseOrderFilters({ pageSize: '100' }), { db }).rows).toHaveLength(55);
    expect(orderOps.list(MANAGER, parseOrderFilters({ pageSize: '7' }), { db }).pageSize).toBe(20);
  });
});

describe('экспорт CSV и печать', () => {
  it('экспорт: право export.run; менеджер без него — 403; фильтры применяются; формулы в ячейках обезврежены', () => {
    const db = withStaff();
    const a = rawOrder(db, 'new');
    db.prepare("UPDATE orders SET contact_name = '=HYPERLINK(\"http://evil\")', contact_name_lc = 'x' WHERE id = ?").run(a.id);
    rawOrder(db, 'confirmed');
    expect(() => orderOps.exportCsv(MANAGER, {}, { db })).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => orderOps.exportCsv(null, {}, { db })).toThrowError(expect.objectContaining({ status: 401 }));
    const all = orderOps.exportCsv(ADMIN, {}, { db });
    expect(all.split('\r\n').filter(Boolean)).toHaveLength(3); // шапка + 2 заказа
    expect(all.startsWith('﻿')).toBe(true);
    expect(all).toContain("'=HYPERLINK");
    const only = orderOps.exportCsv(ADMIN, parseOrderFilters({ status: 'confirmed' }), { db });
    expect(only.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect(audit.list({ entity: 'order' }, { db }).map((l) => l.action)).toContain('order.export');
  });

  it('данные для печати: номер, дата, клиент, состав, итоги; реквизиты магазина — из настроек либо метки, без выдумок', () => {
    const db = withStaff();
    const a = addProduct(db, { price: 10_000 });
    const o = orderWith(db, [{ productId: a, name: 'Триммер', unit: 10_000, qty: 2 }]);
    const doc = orderOps.printData(MANAGER, o.number, { db });
    expect(doc?.order.number).toBe(o.number);
    expect(doc?.order.items).toHaveLength(1);
    expect(doc?.shop.requisites).toBe('[РЕКВИЗИТЫ — впиши]');
    db.prepare("INSERT INTO shop_settings (key, value, updated_at) VALUES ('requisites', 'ИП Тест, ИНН 000', 1)").run();
    expect(orderOps.printData(MANAGER, o.number, { db })?.shop.requisites).toBe('ИП Тест, ИНН 000');
    expect(orderOps.printData(MANAGER, 'RTS-999999', { db })).toBeNull();
    expect(() => orderOps.printData(null, o.number, { db })).toThrowError(expect.objectContaining({ status: 401 }));
  });
});

describe('персональные данные по ролям', () => {
  const WAREHOUSE: StaffSession = { staffId: 5, email: 'w@x.test', name: 'Склад', role: 'warehouse' };
  it('склад (только orders.read) видит замаскированные телефон и email; менеджер — полные', () => {
    const db = withStaff();
    const o = rawOrder(db, 'new');
    expect(orderOps.get(MANAGER, o.number, { db })?.contact).toMatchObject({ phone: '+7 900 111-22-33', email: 'ivan@example.test' });
    const masked = orderOps.get(WAREHOUSE, o.number, { db })!.contact;
    expect(masked.phone).not.toContain('900');
    expect(masked.email).toBe('i***@example.test');
    expect(orderOps.list(WAREHOUSE, {}, { db }).rows[0]!.contactEmail).toBe('i***@example.test');
    const csv = orderOps.exportCsv(WAREHOUSE, {}, { db });
    expect(csv).not.toContain('ivan@example.test');
    expect(orderOps.printData(WAREHOUSE, o.number, { db })!.order.contact.phone).not.toContain('900');
  });
});
