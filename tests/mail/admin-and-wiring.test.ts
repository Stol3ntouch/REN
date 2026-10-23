import { afterEach, describe, expect, it } from 'vitest';
import { setMailEnqueue, enqueueMail } from '@/domain/admin/mail-enqueue';
import { audit } from '@/domain/admin/audit';
import { requestPasswordReset } from '@/domain/customers/auth';
import { register } from '@/domain/customers/auth';
import { mailAdmin } from '@/integrations/mail/admin-ops';
import { connectMail } from '@/integrations/mail/connect';
import { enqueueMailEvent } from '@/integrations/mail/outbox';
import { createStubMailPort } from '@/integrations/mail/ports';
import { processOutbox } from '@/integrations/mail/worker';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError } from '@/server/http/errors';
import { admin, manager } from '../admin/helpers';
import { fakeCookies } from '../auth/helpers';
import { fakePort, MIN, orderCreated, outboxRows, resetPayload, setRecipients, T0 } from './helpers';

const g = globalThis as unknown as { __rtsDb?: unknown };
afterEach(() => {
  setMailEnqueue(null);
  delete g.__rtsDb;
});

describe('подключение очереди к событиям проекта', () => {
  it('connectMail направляет enqueueMail (заказы, сброс пароля) в email_outbox', () => {
    const db = createTestDb();
    g.__rtsDb = db;
    connectMail({ startWorker: false });
    enqueueMail('order.created', orderCreated);
    expect(outboxRows(db).map((r) => r.event)).toEqual(['order.created', 'order.created']);
  });

  it('настоящий сброс пароля попадает в очередь, а токен не виден ни в теме, ни в админском обзоре', async () => {
    const db = createTestDb();
    g.__rtsDb = db;
    connectMail({ startWorker: false });
    await register({ email: 'anna@example.com', password: 'old-password-123', consent: true }, { db, cookies: fakeCookies(), ip: '1.1.1.1', now: T0 });
    await requestPasswordReset({ email: 'anna@example.com' }, { db, ip: '1.1.1.1', now: T0, siteUrl: 'https://shop.test' });

    const rows = outboxRows(db);
    expect(rows).toHaveLength(1);
    const token = (JSON.parse(rows[0]!.payload_json) as { resetUrl: string }).resetUrl.split('/').pop()!;
    expect(token.length).toBeGreaterThan(10);

    const view = mailAdmin.overview(admin, { db, port: createStubMailPort(), now: T0 });
    const dump = JSON.stringify(view);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain('resetUrl');
    expect(dump).not.toContain('anna@example.com');
    expect(view.rows[0]).toMatchObject({ event: 'auth.password_reset', status: 'pending' });
  });

  it('после отправки в таблице не остаётся ссылки-токена', async () => {
    const db = createTestDb();
    const { port } = fakePort();
    enqueueMailEvent(db, 'auth.password_reset', resetPayload, { now: T0 });
    await processOutbox({ db, port, now: T0 + MIN });
    expect(JSON.stringify(outboxRows(db))).not.toContain('SECRET-TOKEN-123');
  });
});

describe('админка почты', () => {
  it('без SMTP показывается предупреждение; ожидающие письма менеджерам без получателей — второе предупреждение', () => {
    const db = createTestDb();
    enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 });
    const view = mailAdmin.overview(admin, { db, port: createStubMailPort(), now: T0 });
    expect(view.status).toMatchObject({ connected: false, mode: 'stub' });
    expect(view.warnings.some((w) => w.includes('SMTP не настроен'))).toBe(true);
    expect(view.warnings.some((w) => w.includes('получател'))).toBe(true);
    expect(view.counts.pending).toBe(2);

    setRecipients(db, ['mgr@shop.test']);
    const ok = mailAdmin.overview(admin, { db, port: fakePort().port, now: T0 });
    expect(ok.warnings).toEqual([]);
  });

  it('адресаты в журнале замаскированы, тема видна', () => {
    const db = createTestDb();
    enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 });
    const row = mailAdmin.overview(admin, { db, port: createStubMailPort() }).rows.find((r) => r.audience === 'customer')!;
    expect(row.to).toBe('a***@example.com');
    expect(row.subject).toBe('Заказ RTS-000123 принят');
  });

  it('журнал почты и повтор — только админу; менеджеру отказ', async () => {
    const db = createTestDb();
    expect(() => mailAdmin.overview(manager, { db, port: createStubMailPort() })).toThrow(ForbiddenError);
    expect(() => mailAdmin.overview(null, { db, port: createStubMailPort() })).toThrow();
    expect(() => mailAdmin.retry(manager, 1, { db })).toThrow(ForbiddenError);
  });

  it('повтор упавшего письма возвращает его в очередь и пишет аудит', async () => {
    const db = createTestDb();
    enqueueMailEvent(db, 'auth.password_reset', resetPayload, { now: T0 });
    const { port } = fakePort({ failTimes: 99 });
    for (const t of [0, 10, 60]) await processOutbox({ db, port, now: T0 + t * MIN });
    expect(outboxRows(db)[0]!.status).toBe('failed');
    mailAdmin.retry(admin, outboxRows(db)[0]!.id, { db, now: T0 + 100 * MIN });
    expect(outboxRows(db)[0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(audit.list({ action: 'mail.retry' }, { db })).toHaveLength(1);
  });
});
