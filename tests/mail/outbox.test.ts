import { describe, expect, it } from 'vitest';
import { enqueueMailEvent } from '@/integrations/mail/outbox';
import { MAX_ATTEMPTS, processOutbox } from '@/integrations/mail/worker';
import { createStubMailPort } from '@/integrations/mail/ports';
import { createTestDb } from '@/server/db/testing';
import { fakePort, MIN, orderCreated, outboxRows, resetPayload, setRecipients, T0 } from './helpers';

describe('очередь писем: постановка', () => {
  it('новый заказ: одно письмо клиенту и одно менеджерам; повторная постановка того же события не плодит дубли', () => {
    const db = createTestDb();
    expect(enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 }).queued).toBe(2);
    expect(enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 + 5 }).queued).toBe(0);
    const rows = outboxRows(db);
    expect(rows.map((r) => [r.audience, r.to_addr])).toEqual([
      ['customer', 'anna@example.com'],
      ['manager', null],
    ]);
    expect(rows[0]!.subject).toBe('Заказ RTS-000123 принят');
    expect(rows[1]!.subject).toBe('Новый заказ RTS-000123');
  });

  it('смена статуса «оплачен» уходит клиенту и менеджерам, «в обработке» — только клиенту', () => {
    const db = createTestDb();
    const base = { to: 'anna@example.com', name: 'Анна', orderNumber: 'RTS-000123', fromStatus: 'awaiting_payment', orderUrl: 'https://shop.test/o' };
    enqueueMailEvent(db, 'order.status_changed', { ...base, toStatus: 'paid', statusLabel: 'Оплачен' }, { now: T0 });
    enqueueMailEvent(db, 'order.status_changed', { ...base, fromStatus: 'paid', toStatus: 'processing', statusLabel: 'В обработке' }, { now: T0 });
    expect(outboxRows(db).map((r) => [r.audience, r.subject])).toEqual([
      ['customer', 'Оплата заказа RTS-000123 получена'],
      ['manager', 'Оплата заказа RTS-000123 получена'],
      ['customer', 'Заказ RTS-000123: В обработке'],
    ]);
  });

  it('ошибка интеграции уходит только админам; неизвестное событие не создаёт писем', () => {
    const db = createTestDb();
    expect(enqueueMailEvent(db, 'integration.failed', { integration: '1С', message: 'нет связи' }, { now: T0 }).queued).toBe(1);
    expect(outboxRows(db)[0]!.audience).toBe('admin');
    expect(enqueueMailEvent(db, 'weird.event', {}, { now: T0 }).queued).toBe(0);
  });
});

describe('очередь писем: отправка', () => {
  it('без SMTP (заглушка) письма остаются pending, попытки не тратятся', async () => {
    const db = createTestDb();
    enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 });
    const res = await processOutbox({ db, port: createStubMailPort(), now: T0 + MIN });
    expect(res).toMatchObject({ sent: 0, deferred: 2 });
    expect(outboxRows(db).map((r) => [r.status, r.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0],
    ]);
  });

  it('успешная отправка уходит один раз, повторная обработка не дублирует, payload очищается', async () => {
    const db = createTestDb();
    setRecipients(db, ['boss@shop.test', 'mgr@shop.test']);
    const { port, sent } = fakePort();
    enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 });
    await processOutbox({ db, port, now: T0 + MIN });
    await processOutbox({ db, port, now: T0 + 2 * MIN });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.to).toEqual(['anna@example.com']);
    expect(sent[0]!.text).toContain('RTS-000123');
    expect(sent[1]!.to).toEqual(['boss@shop.test', 'mgr@shop.test']);
    expect(outboxRows(db).map((r) => [r.status, r.payload_json])).toEqual([
      ['sent', '{}'],
      ['sent', '{}'],
    ]);
  });

  it('письмо менеджерам без заданных получателей ждёт, а после настройки уходит', async () => {
    const db = createTestDb();
    const { port, sent } = fakePort();
    enqueueMailEvent(db, 'repair.created', { number: 'REM-000001', name: 'Иван', phone: '+79161234567' }, { now: T0 });
    await processOutbox({ db, port, now: T0 + MIN });
    expect(sent).toHaveLength(0);
    expect(outboxRows(db)[0]).toMatchObject({ status: 'pending', attempts: 0 });
    setRecipients(db, ['mgr@shop.test']);
    await processOutbox({ db, port, now: T0 + 2 * MIN });
    expect(sent.map((m) => m.to)).toEqual([['mgr@shop.test']]);
  });

  it('письмо менеджеру не содержит полных телефона и email клиента', async () => {
    const db = createTestDb();
    setRecipients(db, ['mgr@shop.test']);
    const { port, sent } = fakePort();
    enqueueMailEvent(db, 'callback.created', { number: 'ZV-000002', name: 'Пётр', phone: '+79161234567', customerEmail: 'petr@example.com' }, { now: T0 });
    await processOutbox({ db, port, now: T0 + MIN });
    const body = sent[0]!.text;
    expect(body).toContain('ZV-000002');
    expect(body).not.toContain('79161234567');
    expect(body).not.toContain('petr@example.com');
  });

  it('сбой повторяется с задержкой и не более MAX_ATTEMPTS раз, затем failed', async () => {
    const db = createTestDb();
    const { port, calls } = fakePort({ failTimes: 99 });
    enqueueMailEvent(db, 'auth.password_reset', resetPayload, { now: T0 });
    expect(MAX_ATTEMPTS).toBe(3);

    await processOutbox({ db, port, now: T0 });
    expect(outboxRows(db)[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(outboxRows(db)[0]!.next_attempt_at).toBeGreaterThan(T0);

    await processOutbox({ db, port, now: T0 + 1000 }); // рано: задержка не прошла
    expect(calls()).toBe(1);

    await processOutbox({ db, port, now: T0 + 10 * MIN });
    await processOutbox({ db, port, now: T0 + 60 * MIN });
    expect(outboxRows(db)[0]).toMatchObject({ status: 'failed', attempts: 3 });

    await processOutbox({ db, port, now: T0 + 600 * MIN });
    expect(calls()).toBe(3);
  });

  it('ошибка без секретов и ПДн: пароль SMTP, email и телефон вычищаются из last_error', async () => {
    const db = createTestDb();
    const { port } = fakePort({ failTimes: 1, error: 'AUTH failed for smtpuser pass s3cr3tpass; rcpt anna@example.com +7 916 123-45-67' });
    enqueueMailEvent(db, 'order.created', { ...orderCreated }, { now: T0 });
    await processOutbox({ db, port, now: T0, secrets: ['s3cr3tpass', 'smtpuser'] });
    const err = outboxRows(db)[0]!.last_error ?? '';
    expect(err).not.toContain('s3cr3tpass');
    expect(err).not.toContain('smtpuser');
    expect(err).not.toContain('anna@example.com');
    expect(err).not.toContain('916 123-45-67');
    expect(err).toContain('AUTH failed');
  });

  it('просроченная ссылка сброса пароля не отправляется и закрывается без попыток', async () => {
    const db = createTestDb();
    const { port, sent } = fakePort();
    enqueueMailEvent(db, 'auth.password_reset', resetPayload, { now: T0 });
    await processOutbox({ db, port, now: resetPayload.expiresAt + MIN });
    expect(sent).toHaveLength(0);
    expect(outboxRows(db)[0]).toMatchObject({ status: 'failed', payload_json: '{}' });
  });
});
