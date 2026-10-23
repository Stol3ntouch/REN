import { describe, expect, it } from 'vitest';
import { mailAdmin } from '@/integrations/mail/admin-ops';
import { enqueueMailEvent } from '@/integrations/mail/outbox';
import { processOutbox } from '@/integrations/mail/worker';
import { createTestDb } from '@/server/db/testing';
import { ConflictError } from '@/server/http/errors';
import { fakePort, MIN, orderCreated, outboxRows, resetPayload, setRecipients, T0 } from '../mail/helpers';

const admin = { staffId: 1, email: 'boss', name: 'Boss', role: 'admin' } as const;

describe('письма с пустым payload не уходят', () => {
  it('сброс пароля после очистки payload не отправляется пустым и закрывается как failed с причиной', async () => {
    const db = createTestDb();
    const { port, sent } = fakePort();
    enqueueMailEvent(db, 'auth.password_reset', resetPayload, { now: T0 });
    db.prepare("UPDATE email_outbox SET payload_json = '{}'").run(); // payload очищен (отправлено/закрыто ранее)
    await processOutbox({ db, port, now: T0 + MIN });
    expect(sent).toHaveLength(0);
    const row = outboxRows(db)[0]!;
    expect(row).toMatchObject({ status: 'failed' });
    expect(row.last_error).toMatch(/пуст|неполн/i);
  });

  it('неполный payload (нет ссылки сброса / номера заказа) тоже не отправляется', async () => {
    const db = createTestDb();
    setRecipients(db, ['mgr@shop.test']);
    const { port, sent } = fakePort();
    enqueueMailEvent(db, 'auth.password_reset', resetPayload, { now: T0 });
    enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 });
    db.prepare("UPDATE email_outbox SET payload_json = ? WHERE event = 'auth.password_reset'").run(JSON.stringify({ to: 'anna@example.com', expiresAt: T0 + 3_600_000 }));
    db.prepare("UPDATE email_outbox SET payload_json = ? WHERE event = 'order.created'").run(JSON.stringify({ to: 'anna@example.com' }));
    const res = await processOutbox({ db, port, now: T0 + MIN });
    expect(sent).toHaveLength(0);
    expect(res.failed).toBe(3);
    expect(outboxRows(db).every((r) => r.status === 'failed')).toBe(true);
  });

  it('битый JSON в payload — тоже терминальный failed, а не отправка пустого письма', async () => {
    const db = createTestDb();
    const { port, sent } = fakePort();
    enqueueMailEvent(db, 'auth.password_reset', resetPayload, { now: T0 });
    db.prepare("UPDATE email_outbox SET payload_json = '{oops'").run();
    await processOutbox({ db, port, now: T0 + MIN });
    expect(sent).toHaveLength(0);
    expect(outboxRows(db)[0]!.status).toBe('failed');
  });

  it('повтор из админки отказывает для письма с очищенным payload', async () => {
    const db = createTestDb();
    enqueueMailEvent(db, 'auth.password_reset', resetPayload, { now: T0 });
    const { port } = fakePort();
    await processOutbox({ db, port, now: resetPayload.expiresAt + MIN }); // просрочена → закрыто, payload очищен
    const id = outboxRows(db)[0]!.id;
    expect(outboxRows(db)[0]).toMatchObject({ status: 'failed', payload_json: '{}' });
    expect(() => mailAdmin.retry(admin, id, { db, now: T0 + 100 * MIN })).toThrow(ConflictError);
    expect(outboxRows(db)[0]!.status).toBe('failed'); // в очередь не вернулось
  });

  it('повтор письма с сохранённым payload по-прежнему работает', async () => {
    const db = createTestDb();
    enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 });
    db.prepare("UPDATE email_outbox SET status = 'failed', attempts = 3").run();
    mailAdmin.retry(admin, outboxRows(db)[0]!.id, { db, now: T0 + 100 * MIN });
    expect(outboxRows(db)[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });
});
