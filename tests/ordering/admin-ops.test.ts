import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { orderOps, parseOrderFilters, promoOps } from '@/domain/ordering/admin-ops';
import { ordersRepo } from '@/server/db/repositories/orders';
import { T0, rawOrder, setupDb } from './helpers';

const ADMIN: StaffSession = { staffId: 1, email: 'boss@x.test', name: 'Босс', role: 'admin' };
const MANAGER: StaffSession = { staffId: 2, email: 'mgr@x.test', name: 'Менеджер', role: 'manager' };

function withStaff() {
  const db = setupDb();
  db.prepare("INSERT INTO staff (id, email, name, role, password_hash, created_at) VALUES (1, 'boss@x.test', 'Босс', 'admin', 'x', 1), (2, 'mgr@x.test', 'Менеджер', 'manager', 'x', 1)").run();
  return db;
}

const PROMO = { code: 'autumn10', type: 'percent' as const, value: 10, startsAt: null, endsAt: null, usageLimit: null, minSubtotalKopecks: 0, enabled: true };

describe('права на админ-операции с заказами и промокодами (R34.1)', () => {
  it('без сессии → 401 на каждой операции', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'new');
    const calls: Array<() => unknown> = [
      () => orderOps.list(null, {}, { db }),
      () => orderOps.get(null, o.number, { db }),
      () => orderOps.changeStatus(null, o.id, 'processing', undefined, { db }),
      () => orderOps.cancel(null, o.id, 'x', { db }),
      () => orderOps.refund(null, o.id, undefined, { db }),
      () => orderOps.assign(null, o.id, 2, { db }),
      () => orderOps.addNote(null, o.id, 'text', { db }),
      () => promoOps.list(null, { db }),
      () => promoOps.create(null, PROMO, { db }),
      () => promoOps.update(null, 1, PROMO, { db }),
      () => promoOps.remove(null, 1, { db }),
    ];
    for (const call of calls) await expect(Promise.resolve().then(call)).rejects.toMatchObject({ status: 401 });
  });

  it('менеджер: заказы — всё, кроме возврата; промокоды — только просмотр (запись → 403)', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'new');
    expect(() => orderOps.list(MANAGER, {}, { db })).not.toThrow();
    expect(orderOps.get(MANAGER, o.number, { db })?.number).toBe(o.number);
    expect((await orderOps.changeStatus(MANAGER, o.id, 'processing', undefined, { db, now: T0 })).status).toBe('processing');
    expect((await orderOps.cancel(MANAGER, o.id, 'клиент передумал', { db, now: T0 })).status).toBe('cancelled');
    expect(orderOps.assign(MANAGER, o.id, 2, { db, now: T0 }).assignedStaffId).toBe(2);
    expect(() => orderOps.addNote(MANAGER, o.id, 'позвонил', { db, now: T0 })).not.toThrow();

    const paid = rawOrder(db, 'processing', { paid: true });
    await expect(orderOps.refund(MANAGER, paid.id, undefined, { db })).rejects.toMatchObject({ status: 403 });

    expect(() => promoOps.list(MANAGER, { db })).not.toThrow();
    for (const call of [() => promoOps.create(MANAGER, PROMO, { db }), () => promoOps.update(MANAGER, 1, PROMO, { db }), () => promoOps.remove(MANAGER, 1, { db })]) {
      expect(call).toThrowError(expect.objectContaining({ status: 403 }));
    }
    expect(promoOps.list(ADMIN, { db })).toEqual([]);
  });

  it('администратор: промокоды CRUD; каждая запись попадает в аудит', () => {
    const db = withStaff();
    const created = promoOps.create(ADMIN, PROMO, { db, now: T0 });
    expect(created.code).toBe('AUTUMN10');
    expect(() => promoOps.create(ADMIN, PROMO, { db, now: T0 })).toThrowError(expect.objectContaining({ status: 409 }));
    const updated = promoOps.update(ADMIN, created.id, { ...PROMO, value: 15, enabled: false }, { db, now: T0 });
    expect(updated).toMatchObject({ value: 15, enabled: false });
    promoOps.remove(ADMIN, created.id, { db, now: T0 });
    expect(promoOps.list(ADMIN, { db })).toEqual([]);
    expect(audit.list({ entity: 'promo' }, { db }).map((r) => r.action).sort()).toEqual(['promo.create', 'promo.delete', 'promo.update']);
  });

  it('промокод проверяется: процент 1–100, период, код; использованный нельзя удалить', () => {
    const db = withStaff();
    for (const bad of [
      { ...PROMO, value: 101 },
      { ...PROMO, value: 0 },
      { ...PROMO, code: 'a' },
      { ...PROMO, code: 'bad code!' },
      { ...PROMO, startsAt: 2000, endsAt: 1000 },
      { ...PROMO, usageLimit: 0 },
      { ...PROMO, type: 'fixed' as const, value: 1.5 },
    ]) {
      expect(() => promoOps.create(ADMIN, bad, { db })).toThrowError(expect.objectContaining({ status: 400 }));
    }
    const p = promoOps.create(ADMIN, PROMO, { db, now: T0 });
    db.prepare('UPDATE promos SET used_count = 3 WHERE id = ?').run(p.id);
    expect(() => promoOps.remove(ADMIN, p.id, { db })).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it('смена статуса и назначение пишут аудит; ответственным нельзя назначить несуществующего', async () => {
    const db = withStaff();
    const o = rawOrder(db, 'new');
    await orderOps.changeStatus(ADMIN, o.id, 'processing', 'принят', { db, now: T0 });
    orderOps.assign(ADMIN, o.id, 2, { db, now: T0 });
    expect(audit.list({ entity: 'order', entityId: String(o.id) }, { db }).map((r) => r.action).sort()).toEqual(['order.assign', 'order.status']);
    expect(() => orderOps.assign(ADMIN, o.id, 999, { db })).toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe('список заказов в админке: поиск и фильтры', () => {
  function seed() {
    const db = withStaff();
    const mk = (over: Record<string, string | number>, status: Parameters<typeof rawOrder>[1], at: number) => {
      const o = rawOrder(db, status, { now: at });
      const set = Object.keys(over)
        .map((k) => `${k} = @${k}`)
        .join(', ');
      db.prepare(`UPDATE orders SET ${set} WHERE id = @id`).run({ ...over, id: o.id });
      return o;
    };
    const day = 86_400_000;
    const a = mk({ contact_name: 'Мария Сидорова', contact_name_lc: 'мария сидорова', contact_email: 'maria@mail.test', contact_phone: '+7 911 222-33-44', phone_digits: '79112223344' }, 'new', T0 - 5 * day);
    const b = mk({ contact_name: 'Олег Орлов', contact_name_lc: 'олег орлов', contact_email: 'oleg@shop.test', phone_digits: '79005556677', assigned_staff_id: 2 }, 'processing', T0 - 2 * day);
    const c = mk({ contact_name: 'Ольга Краснова', contact_name_lc: 'ольга краснова', contact_email: 'olga@shop.test', phone_digits: '79001110000' }, 'cancelled', T0);
    return { db, a, b, c, day };
  }
  const nums = (r: { rows: Array<{ number: string }> }) => r.rows.map((x) => x.number).sort();

  it('поиск по номеру (целиком и по цифрам), email, телефону и имени без учёта регистра', () => {
    const { db, a, b, c } = seed();
    const find = (q: string) => nums(orderOps.list(ADMIN, { q }, { db }));
    expect(find(a.number)).toEqual([a.number]);
    expect(find('2')).toEqual([b.number]);
    expect(find('maria@')).toEqual([a.number]);
    expect(find('8 911 222-33-44')).toEqual([a.number]);
    expect(find('+7 911 222')).toEqual([a.number]);
    expect(find('7900')).toEqual([b.number, c.number].sort());
    expect(find('ОЛЕГ')).toEqual([b.number]);
    expect(find('сидорова')).toEqual([a.number]);
    expect(find('нет такого')).toEqual([]);
  });

  it('спецсимволы поиска не работают как шаблон', () => {
    const { db } = seed();
    expect(orderOps.list(ADMIN, { q: '%' }, { db }).rows).toHaveLength(0);
    expect(orderOps.list(ADMIN, { q: '_' }, { db }).rows).toHaveLength(0);
  });

  it('фильтры по статусу, дате и ответственному; пустой результат — пустой список', () => {
    const { db, a, b, c, day } = seed();
    expect(nums(orderOps.list(ADMIN, { status: 'processing' }, { db }))).toEqual([b.number]);
    expect(nums(orderOps.list(ADMIN, { from: T0 - 3 * day }, { db }))).toEqual([b.number, c.number].sort());
    expect(nums(orderOps.list(ADMIN, { to: T0 - 3 * day }, { db }))).toEqual([a.number]);
    expect(nums(orderOps.list(ADMIN, { assignedStaffId: 2 }, { db }))).toEqual([b.number]);
    expect(orderOps.list(ADMIN, { status: 'shipped' }, { db })).toMatchObject({ rows: [], total: 0 });
    expect(orderOps.list(ADMIN, {}, { db }).total).toBe(ordersRepo.count(db));
  });

  it('parseOrderFilters: мусор из адресной строки безопасно игнорируется', () => {
    expect(parseOrderFilters({ q: '  abc  ', status: 'processing', from: '2026-10-01', to: '2026-10-02' })).toMatchObject({
      q: 'abc',
      status: 'processing',
      from: Date.parse('2026-10-01T00:00:00+03:00'),
      to: Date.parse('2026-10-03T00:00:00+03:00'),
    });
    expect(parseOrderFilters({ status: 'hacked', from: 'yesterday', to: '31.02.2026', page: '-5' })).toEqual({ page: 1 });
  });
});
