import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { orders } from '@/domain/ordering/orders';
import { ORDER_STATUSES, TRANSITIONS, canTransition, type OrderStatus } from '@/domain/ordering/status';
import type { Actor } from '@/domain/ordering/types';
import { ordersRepo } from '@/server/db/repositories/orders';
import { ForbiddenError } from '@/server/http/errors';
import { T0, rawOrder, setupDb } from './helpers';

const SYSTEM: Actor = { type: 'system', reason: 'test' };
const ADMIN: Actor = { type: 'staff', staffId: 1, role: 'admin' };
const MANAGER: Actor = { type: 'staff', staffId: 2, role: 'manager' };

/** Ожидаемая таблица записана независимо от кода: из spec.md (истории 28, 28a) + статус «Подтверждён» (C09). */
const EXPECTED: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'awaiting_payment', 'processing', 'cancelled'],
  confirmed: ['processing', 'cancelled', 'refunded'],
  awaiting_payment: ['paid', 'payment_failed', 'cancelled'],
  payment_failed: ['awaiting_payment', 'cancelled'],
  paid: ['confirmed', 'processing', 'refunded'],
  processing: ['shipped', 'ready_for_pickup', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  ready_for_pickup: ['delivered', 'cancelled', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

/** В этих статусах заказ уже оплачен (is_paid = 1). */
const PAID_STATUSES = new Set<OrderStatus>(['paid', 'processing', 'shipped', 'ready_for_pickup', 'delivered']);

describe('orders.transition: таблица статусов', () => {
  it('в системе ровно одиннадцать статусов (десять из спецификации + «Подтверждён», C09)', () => {
    expect([...ORDER_STATUSES].sort()).toEqual(
      ['new', 'confirmed', 'awaiting_payment', 'paid', 'processing', 'shipped', 'ready_for_pickup', 'delivered', 'cancelled', 'payment_failed', 'refunded'].sort(),
    );
  });

  it('таблица TRANSITIONS совпадает с ожидаемой', () => {
    expect(Object.fromEntries(ORDER_STATUSES.map((s) => [s, [...TRANSITIONS[s]].sort()]))).toEqual(
      Object.fromEntries(ORDER_STATUSES.map((s) => [s, [...EXPECTED[s]].sort()])),
    );
  });

  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      const inTable = EXPECTED[from].includes(to);
      const paid = PAID_STATUSES.has(from);
      // Дополнительные правила: оплаченный нельзя отменить (только вернуть деньги), неоплаченный нельзя вернуть.
      const blockedByPaidRule = (to === 'cancelled' && paid) || (to === 'refunded' && !paid);
      const works = inTable && !blockedByPaidRule;

      it(`${from} → ${to}: ${works ? 'выполняется' : 'отказ'}`, async () => {
        const db = setupDb();
        const o = rawOrder(db, from, { paid });
        expect(canTransition(from, to)).toBe(inTable);
        const run = orders.transition(o.id, to, SYSTEM, undefined, { db, now: T0 + 1000 });
        if (!works) {
          await expect(run).rejects.toMatchObject({ status: 409 });
          expect(ordersRepo.findById(db, o.id)!.status).toBe(from);
          expect(ordersRepo.listEvents(db, o.id)).toHaveLength(0);
          return;
        }
        const after = await run;
        expect(after.status).toBe(to);
        const events = ordersRepo.listEvents(db, o.id);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: 'status', fromStatus: from, toStatus: to, actorType: 'system', at: T0 + 1000 });
        const log = audit.list({ entity: 'order', entityId: String(o.id) }, { db });
        expect(log).toHaveLength(1);
        expect(log[0]!.action).toBe('order.status');
      });
    }
  }
});

describe('orders.transition: правила сверх таблицы', () => {
  it('«оплачен» и «ошибка оплаты» ставит только система: сотрудник и покупатель получают отказ', async () => {
    const db = setupDb();
    const o = rawOrder(db, 'awaiting_payment');
    const customer: Actor = { type: 'customer', owner: { kind: 'user', userId: 1 } };
    await expect(orders.transition(o.id, 'paid', ADMIN, undefined, { db })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(orders.transition(o.id, 'payment_failed', ADMIN, undefined, { db })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(orders.transition(o.id, 'paid', customer, undefined, { db })).rejects.toBeInstanceOf(ForbiddenError);
    expect(ordersRepo.findById(db, o.id)!.status).toBe('awaiting_payment');
    const paid = await orders.transition(o.id, 'paid', SYSTEM, undefined, { db });
    expect(paid.status).toBe('paid');
    expect(paid.isPaid).toBe(true);
  });

  it('возврат: менеджеру нельзя, администратору можно; флаг оплаты снимается', async () => {
    const db = setupDb();
    const o = rawOrder(db, 'processing', { paid: true });
    await expect(orders.transition(o.id, 'refunded', MANAGER, undefined, { db })).rejects.toBeInstanceOf(ForbiddenError);
    // Обычной сменой статуса сотрудник вернуть не может — только через orders.refund (после возврата платежа).
    await expect(orders.transition(o.id, 'refunded', ADMIN, 'по просьбе клиента', { db })).rejects.toBeInstanceOf(ForbiddenError);
    const refunded = await orders.transition(o.id, 'refunded', ADMIN, 'по просьбе клиента', { db, viaRefund: true });
    expect(refunded.status).toBe('refunded');
    expect(refunded.isPaid).toBe(false);
  });

  it('отмена неоплаченного заказа: менеджер и администратор могут; причина попадает в событие', async () => {
    const db = setupDb();
    const a = rawOrder(db, 'new');
    const b = rawOrder(db, 'processing');
    await orders.transition(a.id, 'cancelled', MANAGER, 'клиент передумал', { db });
    await orders.transition(b.id, 'cancelled', ADMIN, undefined, { db });
    expect(ordersRepo.listEvents(db, a.id)[0]!.note).toBe('клиент передумал');
  });

  it('несуществующий заказ → 404', async () => {
    const db = setupDb();
    await expect(orders.transition(9999, 'processing', ADMIN, undefined, { db })).rejects.toMatchObject({ status: 404 });
  });

  it('смена статуса ставит письмо order.status_changed покупателю', async () => {
    const db = setupDb();
    const o = rawOrder(db, 'new');
    await orders.transition(o.id, 'processing', ADMIN, undefined, { db, now: T0 });
    const rows = db.prepare('SELECT event, payload_json FROM mail_stub_queue').all() as { event: string; payload_json: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe('order.status_changed');
    expect(JSON.parse(rows[0]!.payload_json)).toMatchObject({ to: 'ivan@example.test', orderNumber: o.number, fromStatus: 'new', toStatus: 'processing' });
  });
});
