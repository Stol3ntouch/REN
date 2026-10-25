import { describe, expect, it } from 'vitest';
import { customersOps, parseCustomerFilters } from '@/app/admin/(panel)/_lib/customers-ops';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { login } from '@/domain/customers/auth';
import { hashPassword } from '@/domain/customers/password';
import { createUserSession, getSession } from '@/domain/customers/session';
import { checkout } from '@/domain/ordering/checkout';
import { createTestDb } from '@/server/db/testing';
import { rawOrder } from '../ordering/helpers';
import { admin, manager, T0 } from './helpers';

const service: StaffSession = { staffId: 3, email: 's@x.test', name: 'Сервис', role: 'service' };
const nobody: StaffSession = { staffId: 4, email: 'n@x.test', name: 'Никто', role: 'content_manager' };

function setup() {
  const db = createTestDb();
  db.prepare("INSERT INTO staff (id, email, name, role_id, password_hash, created_at) VALUES (1, 'boss@shop.test', 'Админ', (SELECT id FROM roles WHERE code = 'admin'), 'x', 1), (2, 'mgr@shop.test', 'Менеджер', (SELECT id FROM roles WHERE code = 'manager'), 'x', 1)").run();
  const add = (email: string, at: number, name: string | null) => {
    const id = Number(db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, 'HASH-SECRET', ?)").run(email, at).lastInsertRowid);
    if (name) db.prepare("INSERT INTO user_profiles (user_id, name, phone, updated_at) VALUES (?, ?, '+7 900 000-00-01', ?)").run(id, name, at);
    return id;
  };
  const a = add('anna@example.test', T0, 'Анна');
  const b = add('boris@example.test', T0 + 86_400_000 * 3, 'Борис');
  const c = add('vera@example.test', T0 + 86_400_000 * 6, null);
  const o1 = rawOrder(db, 'delivered', { owner: { kind: 'user', userId: a }, paid: true });
  db.prepare('UPDATE orders SET total_kopecks = 300000 WHERE id = ?').run(o1.id);
  const o2 = rawOrder(db, 'cancelled', { owner: { kind: 'user', userId: a } });
  db.prepare('UPDATE orders SET total_kopecks = 900000 WHERE id = ?').run(o2.id);
  rawOrder(db, 'new', { owner: { kind: 'user', userId: b } });
  return { db, a, b, c };
}

describe('клиенты: список, фильтры, сортировка', () => {
  it('число заказов и сумма покупок (без отменённых), статус по умолчанию — активный', () => {
    const { db } = setup();
    const anna = customersOps.list(manager, {}, { db }).rows.find((r) => r.email === 'anna@example.test')!;
    expect(anna).toMatchObject({ ordersCount: 2, spentKopecks: 300000, status: 'active' });
  });

  it('фильтры: статус, период регистрации, есть заказы; сортировка и страницы', () => {
    const { db, b } = setup();
    customersOps.setStatus(admin, b, 'vip', { db, now: T0 });
    const emails = (q: Record<string, string>) => customersOps.list(manager, parseCustomerFilters(q), { db }).rows.map((r) => r.email);
    expect(emails({ status: 'vip' })).toEqual(['boris@example.test']);
    expect(emails({ orders: 'no' })).toEqual(['vera@example.test']);
    expect(emails({ orders: 'yes', sort: 'orders', dir: 'desc' })).toEqual(['anna@example.test', 'boris@example.test']);
    expect(emails({ from: '2026-10-27', to: '2026-10-30' })).toEqual(['vera@example.test']);
    expect(emails({ sort: 'spent', dir: 'desc' })[0]).toBe('anna@example.test');
    expect(emails({ sort: 'x; DROP TABLE users' })).toHaveLength(3);
    expect(customersOps.list(manager, parseCustomerFilters({ pageSize: '7' }), { db }).pageSize).toBe(30);
  });
});

describe('клиенты: профиль, статус, заметки', () => {
  it('профиль: адреса, согласия, заказы, заметки; секретов нет', () => {
    const { db, a } = setup();
    db.prepare("INSERT INTO user_addresses (user_id, label, address, created_at) VALUES (?, 'Дом', 'г. Тула, ул. Мира, 5', 1)").run(a);
    db.prepare("INSERT INTO consents (kind, source, user_id, granted_at) VALUES ('privacy', 'register', ?, 5)").run(a);
    customersOps.addNote(admin, a, 'любит скидки', { db, now: T0 });
    const p = customersOps.get(manager, a, { db })!;
    expect(p.addresses).toHaveLength(1);
    expect(p.consents[0]).toMatchObject({ kind: 'privacy', source: 'register' });
    expect(p.orders).toHaveLength(2);
    expect(p.notes[0]).toMatchObject({ body: 'любит скидки', authorName: 'Админ', createdAt: T0 });
    expect(JSON.stringify(p)).not.toMatch(/HASH-SECRET|password|token/i);
  });

  it('изменения — только customers.write: менеджер (read) получает 403, аноним 401, чужой id 404', () => {
    const { db, a } = setup();
    for (const call of [() => customersOps.setStatus(manager, a, 'vip', { db }), () => customersOps.addNote(manager, a, 'x', { db })]) {
      expect(call).toThrowError(expect.objectContaining({ status: 403 }));
    }
    for (const call of [() => customersOps.setStatus(null, a, 'vip', { db }), () => customersOps.addNote(null, a, 'x', { db }), () => customersOps.get(null, a, { db })]) {
      expect(call).toThrowError(expect.objectContaining({ status: 401 }));
    }
    expect(() => customersOps.get(nobody, a, { db })).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => customersOps.setStatus(admin, 99999, 'vip', { db })).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => customersOps.addNote(admin, 99999, 'x', { db })).toThrowError(expect.objectContaining({ status: 404 }));
    expect(customersOps.get(admin, 99999, { db })).toBeNull();
    expect(() => customersOps.setStatus(admin, a, 'god', { db })).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() => customersOps.addNote(admin, a, '  ', { db })).toThrowError(expect.objectContaining({ status: 400 }));
    expect(customersOps.list(service, {}, { db }).rows).toHaveLength(3);
  });

  it('смена статуса и заметка пишутся в аудит без контактов', () => {
    const { db, a } = setup();
    customersOps.setStatus(admin, a, 'vip', { db, now: T0 });
    customersOps.addNote(admin, a, 'позвонить anna@example.test', { db, now: T0 });
    const log = audit.list({ entity: 'customer' }, { db });
    expect(log.map((l) => l.action).sort()).toEqual(['customer.note', 'customer.status']);
    expect(JSON.stringify(log)).not.toContain('anna@example.test');
  });
});

describe('блокировка клиента', () => {
  it('закрывает вход, текущую сессию и оформление заказа', async () => {
    const { db, a } = setup();
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword('correct-horse-123'), a);
    const jar = new Map<string, string>();
    const cookies = { get: (n: string) => (jar.has(n) ? { value: jar.get(n)! } : undefined), set: (n: string, v: string) => void jar.set(n, v), delete: (n: string) => void jar.delete(n) };
    createUserSession(cookies as never, a, { db, now: T0 });
    expect(getSession(cookies as never, { db, now: T0 })).not.toBeNull();

    customersOps.setStatus(admin, a, 'blocked', { db, now: T0 });
    expect(getSession(cookies as never, { db, now: T0 })).toBeNull();
    await expect(login({ email: 'anna@example.test', password: 'correct-horse-123' }, { cookies: cookies as never, ip: '10.0.0.1', db, now: T0 })).rejects.toMatchObject({ status: 403 });
    await expect(checkout.place({ owner: { kind: 'user', userId: a }, cartId: 1, contact: {}, deliveryMethodId: 1, paymentMethodId: 1, idempotencyKey: 'k'.repeat(20), consent: true }, { db, now: T0 })).rejects.toMatchObject({ status: 403 });

    customersOps.setStatus(admin, a, 'active', { db, now: T0 });
    await expect(login({ email: 'anna@example.test', password: 'correct-horse-123' }, { cookies: cookies as never, ip: '10.0.0.1', db, now: T0 })).resolves.toMatchObject({ userId: a });
  });
});

describe('экспорт клиентов', () => {
  it('нужен export.run; формулы обезврежены; выгрузка в аудите', () => {
    const { db, a } = setup();
    db.prepare("UPDATE user_profiles SET name = '=1+1' WHERE user_id = ?").run(a);
    expect(() => customersOps.exportCsv(manager, {}, { db })).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => customersOps.exportCsv(null, {}, { db })).toThrowError(expect.objectContaining({ status: 401 }));
    const csv = customersOps.exportCsv(admin, {}, { db });
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(4);
    expect(csv).toContain("'=1+1");
    expect(csv).not.toContain('HASH-SECRET');
    expect(audit.list({ entity: 'customer' }, { db }).map((l) => l.action)).toContain('customer.export');
  });
});
