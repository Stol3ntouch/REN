import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { maskEmail, maskPhone, maskPii } from '@/domain/admin/mask';
import { auditRepo } from '@/server/db/repositories/audit';
import { createTestDb } from '@/server/db/testing';

const T0 = Date.UTC(2026, 9, 22, 12);

describe('маскирование ПДн', () => {
  it('email: видна первая буква и домен', () => {
    expect(maskEmail('anna.ivanova@example.com')).toBe('a***@example.com');
    expect(maskEmail('not-an-email')).toBe('***');
  });

  it('телефон: видны только последние 2 цифры', () => {
    const m = maskPhone('+7 (900) 123-45-67');
    expect(m.endsWith('67')).toBe(true);
    expect(m.replace(/\D/g, '')).toBe('67');
    expect(m).not.toContain('900');
  });

  it('maskPii чистит вложенные объекты по ключам и email/телефоны внутри текста, числа и остальное не трогает', () => {
    const out = maskPii({
      email: 'anna@example.com',
      customerPhone: '+79001234567',
      note: 'звонить на +7 900 123-45-67 или писать bob@mail.ru',
      price_kopecks: 129900,
      status: 'new',
      nested: [{ contact_email: 'c@d.ru', qty: 2 }],
    });
    expect(out).toEqual({
      email: 'a***@example.com',
      customerPhone: '***67',
      note: expect.not.stringMatching(/123-45-67|bob@mail\.ru/),
      price_kopecks: 129900,
      status: 'new',
      nested: [{ contact_email: 'c***@d.ru', qty: 2 }],
    });
  });
});

describe('audit', () => {
  it('record пишет событие; before/after с email и телефоном сохраняются замаскированными', () => {
    const db = createTestDb();
    const id = audit.record(
      {
        actorId: 7,
        actorType: 'staff',
        action: 'customer.update',
        entity: 'customer',
        entityId: 42,
        before: { email: 'anna@example.com', phone: '+79001234567' },
        after: { email: 'new@example.com', status: 'active' },
      },
      { db, now: T0 },
    );

    const [row] = audit.list({ entity: 'customer' }, { db });
    expect(row).toMatchObject({ id, at: T0, actorId: '7', actorType: 'staff', action: 'customer.update', entity: 'customer', entityId: '42' });
    expect(row!.before).toEqual({ email: 'a***@example.com', phone: '***67' });
    expect(row!.after).toEqual({ email: 'n***@example.com', status: 'active' });

    const raw = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
    expect(raw).not.toContain('anna@example.com');
    expect(raw).not.toContain('9001234567');
  });

  it('list: новые первыми, фильтры по сущности, действию и исполнителю', () => {
    const db = createTestDb();
    audit.record({ actorId: 1, actorType: 'staff', action: 'price.change', entity: 'product', entityId: 5 }, { db, now: T0 });
    audit.record({ actorId: 2, actorType: 'staff', action: 'order.status', entity: 'order', entityId: 'RTS-1' }, { db, now: T0 + 1 });
    audit.record({ actorId: null, actorType: 'system', action: 'staff.create', entity: 'staff', entityId: 3 }, { db, now: T0 + 2 });

    expect(audit.list({}, { db }).map((r) => r.action)).toEqual(['staff.create', 'order.status', 'price.change']);
    expect(audit.list({ entity: 'order' }, { db })).toHaveLength(1);
    expect(audit.list({ actorId: '1' }, { db })[0]!.action).toBe('price.change');
    expect(audit.list({ action: 'staff.create' }, { db })[0]!.actorId).toBeNull();
    expect(audit.list({ limit: 2, offset: 1 }, { db }).map((r) => r.action)).toEqual(['order.status', 'price.change']);
  });

  it('записи неизменяемы: репозиторий не выставляет update/delete, а БД отклоняет UPDATE и DELETE', () => {
    const db = createTestDb();
    const id = audit.record({ actorId: 1, actorType: 'staff', action: 'a', entity: 'e' }, { db, now: T0 });

    expect(Object.keys(auditRepo).sort()).toEqual(['insert', 'list']);
    expect(Object.keys(audit).sort()).toEqual(['list', 'record']);
    expect(() => db.prepare('UPDATE audit_log SET action = ? WHERE id = ?').run('hacked', id)).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_log WHERE id = ?').run(id)).toThrow(/append-only/);
    expect(audit.list({}, { db })[0]!.action).toBe('a');
  });
});
