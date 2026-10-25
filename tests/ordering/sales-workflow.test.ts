import { describe, expect, it } from 'vitest';
import { orderOps } from '@/domain/ordering/admin-ops';
import { orders } from '@/domain/ordering/orders';
import { ORDER_STATUSES, REVERSE_TRANSITIONS, STATUS_LABELS, TRANSITIONS, canRevert, canTransition } from '@/domain/ordering/status';
import { stock } from '@/domain/catalog/stock';
import type { Actor } from '@/domain/ordering/types';
import type { StaffSession } from '@/domain/admin/permissions';
import { audit } from '@/domain/admin/audit';
import { ordersRepo, type OrderStatus } from '@/server/db/repositories/orders';
import { addProduct, rawOrder, setupDb, T0 } from './helpers';

const ADMIN: StaffSession = { staffId: 1, email: 'boss@x.test', name: 'Босс', role: 'admin' };
const MANAGER: StaffSession = { staffId: 2, email: 'mgr@x.test', name: 'Менеджер', role: 'manager' };
const SERVICE: StaffSession = { staffId: 3, email: 'srv@x.test', name: 'Сервис', role: 'service' };
const adminActor: Actor = { type: 'staff', staffId: 1, role: 'admin' };
const managerActor: Actor = { type: 'staff', staffId: 2, role: 'manager' };
const system: Actor = { type: 'system', reason: 'test' };

function withStaff() {
  const db = setupDb();
  db.prepare(
    "INSERT INTO staff (id, email, name, role_id, password_hash, created_at) VALUES (1, 'boss@x.test', 'Босс', (SELECT id FROM roles WHERE code = 'admin'), 'x', 1), (2, 'mgr@x.test', 'Менеджер', (SELECT id FROM roles WHERE code = 'manager'), 'x', 1), (3, 'srv@x.test', 'Сервис', (SELECT id FROM roles WHERE code = 'service'), 'x', 1)",
  ).run();
  return db;
}

describe('статусы заказа: прямые и обратные переходы', () => {
  it('названия: «Новый, Подтверждён, Собирается, Передан в доставку, Выполнен, Отменён»', () => {
    expect(STATUS_LABELS.new).toBe('Новый');
    expect(STATUS_LABELS.confirmed).toBe('Подтверждён');
    expect(STATUS_LABELS.processing).toBe('Собирается');
    expect(STATUS_LABELS.shipped).toBe('Передан в доставку');
    expect(STATUS_LABELS.delivered).toBe('Выполнен');
    expect(STATUS_LABELS.cancelled).toBe('Отменён');
    // технические статусы сохранены
    for (const s of ['awaiting_payment', 'paid', 'payment_failed', 'refunded', 'ready_for_pickup'] as const) expect(ORDER_STATUSES).toContain(s);
  });

  it('таблица обратных переходов явная: «Собирается → Подтверждён», «Передан в доставку → Собирается»', () => {
    expect(canRevert('processing', 'confirmed')).toBe(true);
    expect(canRevert('shipped', 'processing')).toBe(true);
    expect(canRevert('confirmed', 'new')).toBe(true);
    expect(canRevert('new', 'confirmed')).toBe(false);
    expect(canRevert('refunded', 'delivered')).toBe(false);
    // назад и вперёд — не одно и то же: возврат не размывает прямую таблицу
    expect(canTransition('shipped', 'processing')).toBe(false);
    for (const from of ORDER_STATUSES) for (const to of REVERSE_TRANSITIONS[from]) expect(from).not.toBe(to);
  });

  it('все пары (from → to): сервис пускает ровно то, что разрешает таблица, остальное — 409', async () => {
    const db = withStaff();
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        // «возвращён» требует оплаты, «отменён» — её отсутствия; системный актор не упирается в права
        const paid = to === 'refunded' || from === 'paid' || from === 'refunded';
        const o = rawOrder(db, from, { paid: paid && to !== 'cancelled' });
        const allowed = canTransition(from, to);
        const attempt = orders.transition(o.id, to, system, 'проверка', { db, now: T0, viaRefund: true });
        if (allowed) await expect(attempt).resolves.toMatchObject({ status: to });
        else await expect(attempt, `${from} → ${to}`).rejects.toMatchObject({ status: 409 });
      }
    }
  });

  it('все пары в обратную сторону: возврат разрешён только по таблице, причина обязательна, история остаётся', async () => {
    const db = withStaff();
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const o = rawOrder(db, from, { paid: from === 'paid' || from === 'refunded' });
        const allowed = canRevert(from, to);
        const attempt = orders.transition(o.id, to, adminActor, 'ошибся менеджер', { db, now: T0, revert: true });
        if (allowed) {
          const res = await attempt;
          expect(res.status).toBe(to);
          const events = orders.events(o.id, { db });
          expect(events.at(-1)).toMatchObject({ kind: 'revert', fromStatus: from, toStatus: to, note: 'ошибся менеджер' });
        } else {
          await expect(attempt, `${from} ← ${to}`).rejects.toMatchObject({ status: 409 });
        }
      }
    }
  });

  it('возврат на шаг без причины — ошибка валидации; история не теряется', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'processing');
    await orders.transition(o.id, 'shipped', adminActor, undefined, { db, now: T0 });
    await expect(orders.transition(o.id, 'processing', adminActor, '  ', { db, now: T0, revert: true })).rejects.toMatchObject({ status: 400 });
    await orders.transition(o.id, 'processing', adminActor, 'отгрузка перепутана', { db, now: T0 + 1, revert: true });
    const kinds = orders.events(o.id, { db }).map((e) => e.kind);
    expect(kinds).toEqual(['status', 'revert']);
    expect(ordersRepo.findById(db, o.id)!.status).toBe('processing');
  });

  it('«Выполнен» и «Отменён» возвращает только orders.refund (администратор); менеджер — 403', async () => {
    const db = withStaff();
    const done = rawOrder(db, 'delivered');
    await expect(orders.transition(done.id, 'shipped', managerActor, 'ошибка', { db, now: T0, revert: true })).rejects.toMatchObject({ status: 403 });
    expect((await orders.transition(done.id, 'shipped', adminActor, 'ошибка', { db, now: T0, revert: true })).status).toBe('shipped');
    const cancelled = rawOrder(db, 'cancelled');
    await expect(orders.transition(cancelled.id, 'new', managerActor, 'ошибка', { db, now: T0, revert: true })).rejects.toMatchObject({ status: 403 });
    expect((await orders.transition(cancelled.id, 'new', adminActor, 'ошибка', { db, now: T0, revert: true })).status).toBe('new');
    // обычный возврат (не из финальных) менеджеру разрешён
    const mid = rawOrder(db, 'confirmed');
    expect((await orders.transition(mid.id, 'new', managerActor, 'ошибка', { db, now: T0, revert: true })).status).toBe('new');
  });

  it('оплаченный и возвращённый заказ не возвращаются назад; отмена оплаченного — только через возврат средств', async () => {
    const db = withStaff();
    const refunded = rawOrder(db, 'refunded');
    await expect(orders.transition(refunded.id, 'delivered', adminActor, 'нет', { db, now: T0, revert: true })).rejects.toMatchObject({ status: 409 });
    const paid = rawOrder(db, 'confirmed', { paid: true });
    await expect(orders.transition(paid.id, 'cancelled', adminActor, 'нет', { db, now: T0 })).rejects.toMatchObject({ status: 409 });
  });

  it('подтверждение: new → confirmed → processing; статус confirmed хранится и читается', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'new');
    await orders.transition(o.id, 'confirmed', managerActor, undefined, { db, now: T0 });
    expect(ordersRepo.findById(db, o.id)!.status).toBe('confirmed');
    await orders.transition(o.id, 'processing', managerActor, undefined, { db, now: T0 });
    expect(ordersRepo.findById(db, o.id)!.status).toBe('processing');
    expect(TRANSITIONS.confirmed).toContain('processing');
  });

  it('смена статуса пишет аудит; возврат на шаг — отдельным действием с причиной', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'confirmed');
    await orderOps.revert(MANAGER, o.id, 'new', 'позвонили, ждём', { db, now: T0 });
    const log = audit.list({ entity: 'order' }, { db });
    expect(log.map((l) => l.action)).toContain('order.revert');
    expect(JSON.stringify(log)).toContain('позвонили, ждём');
  });
});

describe('права и IDOR на действиях со статусом заказа', () => {
  it('без сессии — 401; роль без orders.write (склад/сервис) — 403 на смене, возврате на шаг, оплате, правке', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'new');
    const none = null;
    const calls: Array<(s: StaffSession | null) => unknown> = [
      (s) => orderOps.changeStatus(s, o.id, 'confirmed', undefined, { db }),
      (s) => orderOps.revert(s, o.id, 'new', 'x', { db }),
      (s) => orderOps.markPaid(s, o.id, { comment: 'касса', confirm: true }, { db }),
      (s) => orderOps.updateDetails(s, o.id, { name: 'Пётр' }, { db }),
      (s) => orderOps.editItems(s, o.id, { lines: [], reason: 'x' }, { db }),
      (s) => orderOps.addComment(s, o.id, 'текст', { db }),
      (s) => orderOps.refund(s, o.id, undefined, { db }),
    ];
    for (const call of calls) await expect(Promise.resolve().then(() => call(none))).rejects.toMatchObject({ status: 401 });
    for (const call of calls) await expect(Promise.resolve().then(() => call(SERVICE))).rejects.toMatchObject({ status: 403 });
  });

  it('чужой/несуществующий id → 404, не 403', async () => {
    const db = withStaff();
    await expect(orderOps.changeStatus(ADMIN, 99999, 'confirmed', undefined, { db })).rejects.toMatchObject({ status: 404 });
    await expect(orderOps.revert(ADMIN, 99999, 'new', 'x', { db })).rejects.toMatchObject({ status: 404 });
    await expect(Promise.resolve().then(() => orderOps.addComment(ADMIN, 99999, 'x', { db }))).rejects.toMatchObject({ status: 404 });
    await expect(Promise.resolve().then(() => orderOps.updateDetails(ADMIN, 99999, { name: 'Пётр' }, { db }))).rejects.toMatchObject({ status: 404 });
    await expect(orderOps.markPaid(ADMIN, 99999, { comment: 'x', confirm: true }, { db })).rejects.toMatchObject({ status: 404 });
    expect(orderOps.get(ADMIN, 'RTS-999999', { db })).toBeNull();
  });
});

describe('остатки и резерв при переходах (сервис остатков C04, идемпотентно)', () => {
  function tracked(db: ReturnType<typeof withStaff>, qty = 5) {
    const productId = addProduct(db);
    stock.adjust(productId, { set: qty }, 'начальный остаток', null, { db, now: T0 });
    const o = rawOrder(db, 'processing');
    stock.reserveForOrder(o.id, [{ productId, qty: 2 }], { db, now: T0 });
    return { productId, o };
  }
  const state = (db: ReturnType<typeof withStaff>, id: number) => stock.state(id, { db })!;

  it('отгрузка списывает резерв один раз, повторная «Выполнен» остаток не трогает', async () => {
    const db = withStaff();
    const { productId, o } = tracked(db);
    expect([state(db, productId).stockQty, state(db, productId).reservedQty]).toEqual([5, 2]);
    await orders.transition(o.id, 'shipped', adminActor, undefined, { db, now: T0 });
    await orders.transition(o.id, 'delivered', adminActor, undefined, { db, now: T0 });
    expect([state(db, productId).stockQty, state(db, productId).reservedQty]).toEqual([3, 0]);
  });

  it('двойная отмена: резерв возвращается один раз, второй вызов — 409 без побочных эффектов', async () => {
    const db = withStaff();
    const { productId, o } = tracked(db);
    await orders.transition(o.id, 'cancelled', adminActor, 'передумал', { db, now: T0 });
    const moves = stock.history(productId, { db }).length;
    await expect(orders.transition(o.id, 'cancelled', adminActor, 'ещё раз', { db, now: T0 })).rejects.toMatchObject({ status: 409 });
    expect(stock.history(productId, { db })).toHaveLength(moves);
    expect([state(db, productId).stockQty, state(db, productId).reservedQty]).toEqual([5, 0]);
  });

  it('возврат с отгрузки на шаг назад не ломает учёт: остаток остаётся списанным, повторная отгрузка не списывает второй раз', async () => {
    const db = withStaff();
    const { productId, o } = tracked(db);
    await orders.transition(o.id, 'shipped', adminActor, undefined, { db, now: T0 });
    await orders.transition(o.id, 'processing', adminActor, 'не уехал', { db, now: T0, revert: true });
    await orders.transition(o.id, 'shipped', adminActor, undefined, { db, now: T0 });
    expect([state(db, productId).stockQty, state(db, productId).reservedQty]).toEqual([3, 0]);
  });

  it('без учёта остатков переходы работают и ничего не пишут в историю остатка', async () => {
    const db = withStaff();
    const productId = addProduct(db);
    const o = rawOrder(db, 'processing');
    await orders.transition(o.id, 'shipped', adminActor, undefined, { db, now: T0 });
    expect(stock.history(productId, { db })).toHaveLength(0);
  });
});

describe('оплата: только webhook или явное административное действие', () => {
  it('«Отметить оплаченным» (оплата при получении): право orders.write, подтверждение и комментарий обязательны, пишется событие payment.manual и аудит', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'processing');
    await expect(orderOps.markPaid(MANAGER, o.id, { comment: 'принял наличные', confirm: false }, { db, now: T0 })).rejects.toMatchObject({ status: 400 });
    await expect(orderOps.markPaid(MANAGER, o.id, { comment: '  ', confirm: true }, { db, now: T0 })).rejects.toMatchObject({ status: 400 });
    const res = await orderOps.markPaid(MANAGER, o.id, { comment: 'принял наличные при выдаче', confirm: true }, { db, now: T0 });
    expect(res.isPaid).toBe(true);
    expect(res.status).toBe('processing'); // статус не трогаем: это не платёжное событие
    const ev = orders.events(o.id, { db }).at(-1)!;
    expect(ev).toMatchObject({ kind: 'payment.manual', note: 'принял наличные при выдаче' });
    expect(audit.list({ entity: 'order' }, { db }).map((l) => l.action)).toContain('payment.manual');
    await expect(orderOps.markPaid(MANAGER, o.id, { comment: 'ещё раз', confirm: true }, { db, now: T0 })).rejects.toMatchObject({ status: 409 });
  });

  it('онлайн-оплата вручную не подтверждается: только webhook', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'awaiting_payment');
    db.prepare("UPDATE orders SET payment_kind = 'online', payment_code = 'test', payment_name = 'Онлайн' WHERE id = ?").run(o.id);
    await expect(orderOps.markPaid(ADMIN, o.id, { comment: 'не пришло', confirm: true }, { db, now: T0 })).rejects.toMatchObject({ status: 409 });
    expect(ordersRepo.findById(db, o.id)!.isPaid).toBe(false);
  });

  it('отменённый или возвращённый заказ оплаченным не отметить', async () => {
    const db = withStaff();
    for (const s of ['cancelled', 'refunded'] as OrderStatus[]) {
      const o = rawOrder(db, s);
      await expect(orderOps.markPaid(ADMIN, o.id, { comment: 'x', confirm: true }, { db, now: T0 })).rejects.toMatchObject({ status: 409 });
    }
  });

  it('возврат средств: право orders.refund; без платёжного провайдера честное «не подключено»', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'processing', { paid: true });
    await expect(orderOps.refund(MANAGER, o.id, undefined, { db })).rejects.toMatchObject({ status: 403 });
    await expect(orderOps.refund(ADMIN, o.id, undefined, { db, refunder: undefined })).rejects.toMatchObject({ status: 409 });
    // оплата прошла не через платёжную систему — вернуть через провайдера нечего
    expect(orderOps.paymentInfo(ADMIN, o.id, { db }).refundAvailable).toBe(false);
    // production без выбранного провайдера: честное «не подключено», кнопки возврата нет
    const prod = orderOps.paymentInfo(ADMIN, o.id, { db, production: true });
    expect(prod.refundAvailable).toBe(false);
    expect(prod.providerConnected).toBe(false);
    expect(prod.refundNote).toMatch(/не подключ[её]н/i);
    // тестовый провайдер и успешный платёж — возврат доступен
    db.prepare("INSERT INTO payments (order_id, provider, status, amount_kopecks, external_id, created_at, updated_at) VALUES (?, 'test', 'succeeded', 100, 'ext-r1', 1, 1)").run(o.id);
    expect(orderOps.paymentInfo(ADMIN, o.id, { db }).refundAvailable).toBe(true);
    expect(() => orderOps.paymentInfo(MANAGER, o.id, { db })).not.toThrow(); // видеть можно, кнопку покажет страница по праву orders.refund
    expect(() => orderOps.paymentInfo(null, o.id, { db })).toThrow();
  });
});

describe('статус меняет только orders.transition', () => {
  it('прямой UPDATE status запрещён политикой: ordersRepo.setStatus используется лишь внутри orders.ts', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const root = resolve(__dirname, '../../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && readFileSync(p, 'utf8').includes('ordersRepo.setStatus(') && !p.endsWith('orders.ts') && !p.includes('repositories')) offenders.push(p);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    expect(addProduct).toBeTypeOf('function');
  });
});
