import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { stock } from '@/domain/catalog/stock';
import { readLowStockThreshold, warehouseReports, warehouseStock, warehousesAdmin } from '@/domain/catalog/warehouses';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { orders } from '@/domain/ordering/orders';
import { stockOps } from '@/app/admin/(panel)/_lib/stock-ops';
import { warehousesRepo } from '@/server/db/repositories/warehouses';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import type { Db } from '@/server/db/connection';
import { GUEST_A, T0, addProduct, deliveryId, paymentId, setupDb } from '../ordering/helpers';
import { admin, manager } from './helpers';

const WAREHOUSE: StaffSession = { staffId: 5, email: 'w@shop.test', name: 'Склад', role: 'warehouse' };
const o = (db: Db) => ({ db, now: T0 });
const wh = (over: Record<string, unknown> = {}) => ({ name: 'Склад 2', address: 'ул. Складская, 1', active: true, sort: 10, ...over });
const op = (productId: number, warehouseId: number, qty: number, reason = 'приёмка') => ({ productId, warehouseId, qty, reason });

function mainId(db: Db): number {
  return warehousesRepo.defaultId(db)!;
}

function expectConsistent(db: Db): void {
  expect(warehousesRepo.invariantViolations(db)).toEqual([]);
}

describe('склады: миграция и склад по умолчанию', () => {
  it('в чистой БД один склад «Основной склад» без выдуманного адреса, он по умолчанию и активен', () => {
    const db = setupDb();
    const list = warehousesAdmin.list(admin, o(db));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Основной склад', address: null, isDefault: true, active: true });
  });

  it('остаток уже учитываемых товаров переезжает на основной склад при миграции', async () => {
    const { copyFileSync, mkdtempSync, readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join, resolve } = await import('node:path');
    const { openDatabase } = await import('@/server/db/connection');
    const { runMigrations } = await import('@/server/db/migrate');
    const MIGRATIONS = resolve(__dirname, '../../migrations');
    const dir = mkdtempSync(join(tmpdir(), 'rts-mig1560-'));
    for (const f of readdirSync(MIGRATIONS)) if (Number(f.slice(0, 4)) < 1560) copyFileSync(join(MIGRATIONS, f), join(dir, f));
    const db = openDatabase(':memory:');
    runMigrations(db, { dir });
    const tracked = addProduct(db);
    const untracked = addProduct(db);
    db.prepare('UPDATE products SET stock_qty = 7, reserved_qty = 2, stock_tracked = 1 WHERE id = ?').run(tracked);
    db.prepare("INSERT INTO stock_movements (product_id, delta, qty_after, reserved_delta, reserved_after, reason, created_at) VALUES (?, 7, 7, 0, 0, 'старое', 'x')").run(tracked);
    runMigrations(db, { dir: MIGRATIONS });
    expect(warehousesRepo.rowsFor(db, tracked)).toEqual([{ productId: tracked, warehouseId: mainId(db), qty: 7, reserved: 2 }]);
    expect(warehousesRepo.rowsFor(db, untracked)).toEqual([]);
    expect(db.prepare('SELECT warehouse_id AS w FROM stock_movements').get()).toEqual({ w: mainId(db) });
    expectConsistent(db);
  });
});

describe('инвариант: сумма по складам = остаток товара', () => {
  it('оприходование включает учёт и кладёт остаток на выбранный склад', () => {
    const db = setupDb();
    const p = addProduct(db);
    const w2 = warehousesAdmin.create(admin, wh(), o(db));
    warehouseStock.receive(admin, op(p, w2, 5), o(db));
    expect(stock.state(p, { db })).toMatchObject({ stockQty: 5 });
    expect(warehousesRepo.rowsFor(db, p)).toEqual([{ productId: p, warehouseId: w2, qty: 5, reserved: 0 }]);
    expectConsistent(db);
  });

  it('перемещение не меняет итог и оставляет одну строку истории с обоими складами', () => {
    const db = setupDb();
    const p = addProduct(db);
    const w2 = warehousesAdmin.create(admin, wh(), o(db));
    warehouseStock.receive(admin, op(p, mainId(db), 10), o(db));
    warehouseStock.transfer(admin, { productId: p, fromWarehouseId: mainId(db), toWarehouseId: w2, qty: 4, reason: 'на витрину' }, o(db));
    expect(stock.state(p, { db })!.stockQty).toBe(10);
    expect(warehousesRepo.row(db, p, mainId(db))!.qty).toBe(6);
    expect(warehousesRepo.row(db, p, w2)!.qty).toBe(4);
    const last = warehousesRepo.movements(db, { limit: 5, offset: 0 }).rows[0]!;
    expect(last).toMatchObject({ delta: 0, movedQty: 4, warehouseId: mainId(db), toWarehouseId: w2, reason: 'на витрину' });
    expectConsistent(db);
  });

  it('списание: только из свободного остатка склада; резерв заказа не списывается', async () => {
    const db = setupDb();
    const p = addProduct(db, { price: 100_000 });
    warehouseStock.receive(admin, op(p, mainId(db), 3), o(db));
    cart.add(GUEST_A, { productId: p, qty: 2 }, { db, now: T0 });
    await checkout.place(
      { owner: GUEST_A, cartId: cart.get(GUEST_A, { db }).cartId, contact: { name: 'Иван Иванов', email: 'i@e.test', phone: '+7 900 111-22-33' }, deliveryMethodId: deliveryId(db, 'pickup'), paymentMethodId: paymentId(db, 'cod'), idempotencyKey: 'key-reserve-abcdefgh-1234', consent: true },
      { db, now: T0, secret: 'x'.repeat(40) },
    );
    expect(warehousesRepo.row(db, p, mainId(db))).toMatchObject({ qty: 3, reserved: 2 });
    expect(() => warehouseStock.writeOff(admin, op(p, mainId(db), 2, 'брак'), o(db))).toThrow(ConflictError); // свободно 1
    warehouseStock.writeOff(admin, op(p, mainId(db), 1, 'брак'), o(db));
    expect(warehousesRepo.row(db, p, mainId(db))).toMatchObject({ qty: 2, reserved: 2 });
    expectConsistent(db);
  });

  it('заказ: резерв и списание при отгрузке идут по складам и сохраняют инвариант', async () => {
    const db = setupDb();
    const p = addProduct(db, { price: 100_000 });
    const w2 = warehousesAdmin.create(admin, wh(), o(db));
    warehouseStock.receive(admin, op(p, mainId(db), 1), o(db));
    warehouseStock.receive(admin, op(p, w2, 5), o(db));
    cart.add(GUEST_A, { productId: p, qty: 4 }, { db, now: T0 });
    const order = await checkout.place(
      { owner: GUEST_A, cartId: cart.get(GUEST_A, { db }).cartId, contact: { name: 'Иван Иванов', email: 'i@e.test', phone: '+7 900 111-22-33' }, deliveryMethodId: deliveryId(db, 'pickup'), paymentMethodId: paymentId(db, 'cod'), idempotencyKey: 'key-ship-abcdefgh-12345', consent: true },
      { db, now: T0, secret: 'x'.repeat(40) },
    );
    expect(stock.state(p, { db })).toMatchObject({ stockQty: 6, reservedQty: 4 });
    expectConsistent(db);
    await orders.transition(order.id, 'processing', { type: 'staff', staffId: 1, role: 'admin' }, undefined, { db, now: T0 });
    await orders.transition(order.id, 'shipped', { type: 'staff', staffId: 1, role: 'admin' }, undefined, { db, now: T0 });
    expect(stock.state(p, { db })).toMatchObject({ stockQty: 2, reservedQty: 0 });
    expectConsistent(db);
  });

  it('старый путь (форма товара): изменение итога делится по складам, инвариант цел', () => {
    const db = setupDb();
    const p = addProduct(db);
    const w2 = warehousesAdmin.create(admin, wh(), o(db));
    warehouseStock.receive(admin, op(p, mainId(db), 2), o(db));
    warehouseStock.receive(admin, op(p, w2, 8), o(db));
    stockOps.adjust(admin, p, { set: 4 }, 'инвентаризация', o(db)); // −6: основной отдаёт 2, второй 4
    expect(stock.state(p, { db })!.stockQty).toBe(4);
    expectConsistent(db);
    stockOps.adjust(admin, p, { set: 9 }, 'приход', o(db)); // +5 на склад по умолчанию
    expect(warehousesRepo.row(db, p, mainId(db))!.qty).toBe(5);
    expectConsistent(db);
  });

  it('случайная серия операций не ломает инвариант и не уводит остатки в минус', () => {
    const db = setupDb();
    const ps = [addProduct(db), addProduct(db), addProduct(db)];
    const ws = [mainId(db), warehousesAdmin.create(admin, wh(), o(db)), warehousesAdmin.create(admin, wh({ name: 'Склад 3' }), o(db))];
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 200; i += 1) {
      const p = ps[rnd(ps.length)]!;
      const a = ws[rnd(ws.length)]!;
      const b = ws[rnd(ws.length)]!;
      const q = 1 + rnd(6);
      try {
        const kind = rnd(3);
        if (kind === 0) warehouseStock.receive(admin, op(p, a, q), o(db));
        else if (kind === 1) warehouseStock.writeOff(admin, op(p, a, q, 'списание'), o(db));
        else if (a !== b) warehouseStock.transfer(admin, { productId: p, fromWarehouseId: a, toWarehouseId: b, qty: q, reason: 'перемещение' }, o(db));
      } catch (e) {
        expect(e).toBeInstanceOf(ConflictError); // отказ допустим, поломка — нет
      }
      expectConsistent(db);
    }
    const rows = db.prepare('SELECT qty, reserved FROM stock_by_warehouse').all() as { qty: number; reserved: number }[];
    expect(rows.every((r) => r.qty >= 0 && r.reserved >= 0 && r.reserved <= r.qty)).toBe(true);
  });

  it('недостаток остатка при перемещении — отказ без изменений', () => {
    const db = setupDb();
    const p = addProduct(db);
    const w2 = warehousesAdmin.create(admin, wh(), o(db));
    warehouseStock.receive(admin, op(p, mainId(db), 2), o(db));
    expect(() => warehouseStock.transfer(admin, { productId: p, fromWarehouseId: mainId(db), toWarehouseId: w2, qty: 3, reason: 'x' }, o(db))).toThrow(ConflictError);
    expect(warehousesRepo.row(db, p, mainId(db))!.qty).toBe(2);
    expect(warehousesRepo.row(db, p, w2)).toBeNull();
  });
});

describe('проверки ввода', () => {
  it('причина обязательна, количество — целое от 1, склады должны отличаться', () => {
    const db = setupDb();
    const p = addProduct(db);
    const w2 = warehousesAdmin.create(admin, wh(), o(db));
    const bad = (fn: () => unknown) => expect(fn).toThrow(ValidationError);
    bad(() => warehouseStock.receive(admin, op(p, w2, 1, '   '), o(db)));
    bad(() => warehouseStock.receive(admin, op(p, w2, 0), o(db)));
    bad(() => warehouseStock.receive(admin, op(p, w2, -3), o(db)));
    bad(() => warehouseStock.receive(admin, op(p, w2, 1.5), o(db)));
    bad(() => warehouseStock.transfer(admin, { productId: p, fromWarehouseId: w2, toWarehouseId: w2, qty: 1, reason: 'x' }, o(db)));
  });

  it('на отключённый склад принимать и перемещать нельзя', () => {
    const db = setupDb();
    const p = addProduct(db);
    const w2 = warehousesAdmin.create(admin, wh({ active: false }), o(db));
    expect(() => warehouseStock.receive(admin, op(p, w2, 1), o(db))).toThrow(ConflictError);
    warehouseStock.receive(admin, op(p, mainId(db), 2), o(db));
    expect(() => warehouseStock.transfer(admin, { productId: p, fromWarehouseId: mainId(db), toWarehouseId: w2, qty: 1, reason: 'x' }, o(db))).toThrow(ConflictError);
  });

  it('склад: проверки полей, отключение только пустого и не основного, удаление без истории', () => {
    const db = setupDb();
    expect(() => warehousesAdmin.create(admin, wh({ name: 'А' }), o(db))).toThrow(ValidationError);
    const w2 = warehousesAdmin.create(admin, wh(), o(db));
    const p = addProduct(db);
    warehouseStock.receive(admin, op(p, w2, 2), o(db));
    expect(() => warehousesAdmin.update(admin, w2, wh({ active: false }), o(db))).toThrow(ConflictError); // есть остаток
    expect(() => warehousesAdmin.update(admin, mainId(db), wh({ name: 'Основной склад', active: false }), o(db))).toThrow(ConflictError);
    expect(() => warehousesAdmin.remove(admin, w2, o(db))).toThrow(ConflictError);
    const empty = warehousesAdmin.create(admin, wh({ name: 'Пустой' }), o(db));
    warehousesAdmin.remove(admin, empty, o(db));
    expect(warehousesRepo.find(db, empty)).toBeNull();
    expect(() => warehousesAdmin.remove(admin, mainId(db), o(db))).toThrow(ConflictError);
  });

  it('склад по умолчанию меняется только на действующий', () => {
    const db = setupDb();
    const off = warehousesAdmin.create(admin, wh({ active: false }), o(db));
    expect(() => warehousesAdmin.setDefault(admin, off, o(db))).toThrow(ConflictError);
    const on = warehousesAdmin.create(admin, wh({ name: 'Новый основной' }), o(db));
    warehousesAdmin.setDefault(admin, on, o(db));
    expect(mainId(db)).toBe(on);
    expect(warehousesRepo.list(db).filter((w) => w.isDefault)).toHaveLength(1);
  });
});

describe('страница «Склад»: остатки, история, резервы, пороги', () => {
  it('низкие остатки по порогу из настроек', () => {
    const db = setupDb();
    const low = addProduct(db, { name: 'Мало' });
    const lots = addProduct(db, { name: 'Много' });
    warehouseStock.receive(admin, op(low, mainId(db), 2), o(db));
    warehouseStock.receive(admin, op(lots, mainId(db), 50), o(db));
    expect(readLowStockThreshold(db)).toBe(5);
    expect(warehouseReports.stock(admin, { lowOnly: true, limit: 50, offset: 0 }, o(db)).rows.map((r) => r.name)).toEqual(['Мало']);
    warehouseReports.setThreshold(admin, 100, o(db));
    expect(warehouseReports.stock(admin, { lowOnly: true, limit: 50, offset: 0 }, o(db)).rows).toHaveLength(2);
    expect(() => warehouseReports.setThreshold(admin, -1, o(db))).toThrow(ValidationError);
    expect(() => warehouseReports.setThreshold(admin, 1.5, o(db))).toThrow(ValidationError);
  });

  it('история: фильтры по складу, виду, периоду и тексту, пагинация', () => {
    const db = setupDb();
    const p = addProduct(db, { name: 'Бензопила' });
    const w2 = warehousesAdmin.create(admin, wh(), o(db));
    warehouseStock.receive(admin, op(p, mainId(db), 10, 'поставка №1'), { db, now: Date.UTC(2026, 9, 1) });
    warehouseStock.receive(admin, op(p, w2, 4, 'поставка №2'), { db, now: Date.UTC(2026, 9, 5) });
    warehouseStock.transfer(admin, { productId: p, fromWarehouseId: mainId(db), toWarehouseId: w2, qty: 2, reason: 'перенос' }, { db, now: Date.UTC(2026, 9, 6) });
    warehouseStock.writeOff(admin, op(p, w2, 1, 'брак'), { db, now: Date.UTC(2026, 9, 7) });
    const q = (f: Record<string, unknown>) => warehouseReports.movements(admin, { limit: 50, offset: 0, ...f }, o(db));
    expect(q({}).total).toBe(4);
    expect(q({ kind: 'receipt' }).rows.map((r) => r.reason)).toEqual(['поставка №2', 'поставка №1']);
    expect(q({ kind: 'transfer' }).rows).toHaveLength(1);
    expect(q({ kind: 'writeoff' }).rows.map((r) => r.reason)).toEqual(['брак']);
    expect(q({ warehouseId: w2 }).total).toBe(3); // приход, перемещение (получатель), списание
    expect(q({ from: new Date(Date.UTC(2026, 9, 5)).toISOString(), to: new Date(Date.UTC(2026, 9, 7)).toISOString() }).total).toBe(2);
    expect(q({ q: 'бензо' }).total).toBe(4);
    expect(q({ q: 'нет такого' }).total).toBe(0);
    const page = q({ limit: 2, offset: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(4);
  });

  it('резервы под заказы видны вместе с номером заказа', async () => {
    const db = setupDb();
    const p = addProduct(db, { price: 100_000 });
    warehouseStock.receive(admin, op(p, mainId(db), 5), o(db));
    cart.add(GUEST_A, { productId: p, qty: 2 }, { db, now: T0 });
    const order = await checkout.place(
      { owner: GUEST_A, cartId: cart.get(GUEST_A, { db }).cartId, contact: { name: 'Иван Иванов', email: 'i@e.test', phone: '+7 900 111-22-33' }, deliveryMethodId: deliveryId(db, 'pickup'), paymentMethodId: paymentId(db, 'cod'), idempotencyKey: 'key-res-abcdefgh-123456', consent: true },
      { db, now: T0, secret: 'x'.repeat(40) },
    );
    const res = warehouseReports.reserves(admin, { limit: 20, offset: 0 }, o(db));
    expect(res.rows).toEqual([expect.objectContaining({ orderNumber: order.number, qty: 2, productId: p })]);
  });
});

describe('права, аудит', () => {
  it('операции и склады — только warehouses.write; роль «склад» может, менеджер нет', () => {
    const db = setupDb();
    const p = addProduct(db);
    const w2 = warehousesAdmin.create(WAREHOUSE, wh(), o(db));
    warehouseStock.receive(WAREHOUSE, op(p, w2, 3), o(db));
    expect(() => warehouseStock.receive(manager, op(p, w2, 1), o(db))).toThrow(ForbiddenError);
    expect(() => warehouseStock.writeOff(manager, op(p, w2, 1), o(db))).toThrow(ForbiddenError);
    expect(() => warehouseStock.transfer(manager, { productId: p, fromWarehouseId: w2, toWarehouseId: mainId(db), qty: 1, reason: 'x' }, o(db))).toThrow(ForbiddenError);
    expect(() => warehousesAdmin.create(manager, wh(), o(db))).toThrow(ForbiddenError);
    expect(() => warehousesAdmin.update(manager, w2, wh(), o(db))).toThrow(ForbiddenError);
    expect(() => warehousesAdmin.setDefault(manager, w2, o(db))).toThrow(ForbiddenError);
    expect(() => warehousesAdmin.remove(manager, w2, o(db))).toThrow(ForbiddenError);
    expect(() => warehouseReports.setThreshold(manager, 3, o(db))).toThrow(ForbiddenError);
    expect(() => warehouseStock.receive(null, op(p, w2, 1), o(db))).toThrow(UnauthorizedError);
  });

  it('просмотр открыт и тем, у кого есть право на каталог; без прав — нет', () => {
    const db = setupDb();
    expect(() => warehouseReports.stock(manager, { limit: 10, offset: 0 }, o(db))).not.toThrow(); // у менеджера catalog.read
    const nobody: StaffSession = { staffId: 9, email: 'n@x.test', name: null, role: 'nobody' };
    expect(() => warehouseReports.stock(nobody, { limit: 10, offset: 0 }, o(db))).toThrow(ForbiddenError);
  });

  it('каждая операция попадает в журнал аудита', () => {
    const db = setupDb();
    const p = addProduct(db);
    const w2 = warehousesAdmin.create(admin, wh(), o(db));
    warehouseStock.receive(admin, op(p, mainId(db), 3), o(db));
    warehouseStock.transfer(admin, { productId: p, fromWarehouseId: mainId(db), toWarehouseId: w2, qty: 1, reason: 'x' }, o(db));
    warehouseStock.writeOff(admin, op(p, w2, 1, 'брак'), o(db));
    expect(audit.list({}, { db }).map((r) => r.action).filter((a) => a.startsWith('warehouse.')).sort()).toEqual(['warehouse.create', 'warehouse.receive', 'warehouse.transfer', 'warehouse.writeoff']);
  });
});
