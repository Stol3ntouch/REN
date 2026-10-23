import { describe, expect, it } from 'vitest';
import { customersOps } from '@/app/admin/(panel)/_lib/customers-ops';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';
import { rawOrder } from '../ordering/helpers';
import { admin, manager, T0 } from './helpers';

function setup() {
  const db = createTestDb();
  const u1 = Number(db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('anna@example.test', 'HASH-SECRET', ?)").run(T0).lastInsertRowid);
  const u2 = Number(db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('boris@example.test', 'HASH-SECRET', ?)").run(T0).lastInsertRowid);
  db.prepare("INSERT INTO user_profiles (user_id, name, phone, updated_at) VALUES (?, 'Анна Петрова', '+7 900 000-00-01', ?)").run(u1, T0);
  const o1 = rawOrder(db, 'delivered', { owner: { kind: 'user', userId: u1 }, paid: true, now: T0 });
  rawOrder(db, 'cancelled', { owner: { kind: 'user', userId: u1 }, now: T0 });
  rawOrder(db, 'new', { owner: { kind: 'user', userId: u2 }, now: T0 });
  return { db, u1, u2, o1 };
}

describe('покупатели', () => {
  it('manager и admin видят список и профиль; аноним — 401', () => {
    const { db, u1 } = setup();
    expect(() => customersOps.list(null, {}, { db })).toThrow(UnauthorizedError);
    for (const s of [manager, admin]) {
      expect(customersOps.list(s, {}, { db }).rows).toHaveLength(2);
      expect(customersOps.get(s, u1, { db })?.user.email).toBe('anna@example.test');
    }
  });

  it('в списке контакты и итоги по заказам; хеш пароля никогда не отдаётся', () => {
    const { db } = setup();
    const res = customersOps.list(manager, {}, { db });
    const anna = res.rows.find((r) => r.email === 'anna@example.test')!;
    expect(anna).toMatchObject({ name: 'Анна Петрова', phone: '+7 900 000-00-01', ordersCount: 2 });
    expect(JSON.stringify(res)).not.toContain('HASH-SECRET');
  });

  it('профиль: контакты и заказы; несуществующий покупатель → null', () => {
    const { db, u1, o1 } = setup();
    const p = customersOps.get(manager, u1, { db })!;
    expect(p.orders.map((o) => o.number)).toContain(o1.number);
    expect(p.orders).toHaveLength(2);
    expect(JSON.stringify(p)).not.toContain('HASH-SECRET');
    expect(customersOps.get(manager, 9999, { db })).toBeNull();
  });

  it('поиск по email и имени, без учёта регистра', () => {
    const { db } = setup();
    expect(customersOps.list(manager, { q: 'BORIS' }, { db }).rows.map((r) => r.email)).toEqual(['boris@example.test']);
    expect(customersOps.list(manager, { q: 'анна' }, { db }).rows.map((r) => r.email)).toEqual(['anna@example.test']);
  });

  it('право customers.read действительно проверяется (роль без права отвергается)', () => {
    const { db } = setup();
    expect(() => customersOps.list({ ...manager, role: 'nobody' as never }, {}, { db })).toThrow(ForbiddenError);
  });
});
