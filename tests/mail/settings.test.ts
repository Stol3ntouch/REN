import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { enqueueMailEvent } from '@/integrations/mail/outbox';
import { DEFAULT_TEMPLATES, MAIL_EVENTS, renderTemplateText, sampleFor, templateProblems } from '@/integrations/mail/settings';
import { mailSettingsAdmin } from '@/integrations/mail/settings-ops';
import { planMessages, renderBody } from '@/integrations/mail/templates';
import { processOutbox } from '@/integrations/mail/worker';
import { createStubMailPort } from '@/integrations/mail/ports';
import type { MailPort } from '@/integrations/mail/types';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, ForbiddenError, RateLimitError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { admin, manager } from '../admin/helpers';
import { fakePort, orderCreated, outboxRows, resetPayload, setRecipients, T0 } from './helpers';

describe('шаблоны по умолчанию совпадают с текстами из кода', () => {
  for (const def of MAIL_EVENTS) {
    for (const audience of def.audiences) {
      it(`${def.event} → ${audience}`, () => {
        const d = DEFAULT_TEMPLATES[def.event]?.[audience];
        expect(d, 'нет шаблона по умолчанию').toBeDefined();
        expect(templateProblems(def.event, audience, d!.subject, d!.body)).toEqual([]);
        const sample = sampleFor(def, audience);
        expect(renderTemplateText(d!.body, def, audience, sample)).toBe(renderBody(def.event, audience, sample));
        const planned = planMessages(def.event, sample).find((m) => m.audience === audience);
        expect(planned, 'код не планирует такое письмо').toBeDefined();
        expect(renderTemplateText(d!.subject, def, audience, sample)).toBe(planned!.subject);
      });
    }
  }
});

describe('проверка шаблона', () => {
  const ok = { subject: 'Заказ {order_number}', body: 'Привет! {order_number}' };
  it('допустимый шаблон', () => expect(templateProblems('order.created', 'customer', ok.subject, ok.body)).toEqual([]));
  it('неизвестная переменная и лишняя скобка', () => {
    expect(templateProblems('order.created', 'customer', ok.subject, 'x {foo}').join()).toContain('{foo}');
    expect(templateProblems('order.created', 'customer', ok.subject, 'x { y').join()).toContain('скобка');
  });
  it('переменная только для менеджеров недоступна клиенту (нет ссылки в админку)', () => {
    expect(templateProblems('order.created', 'customer', ok.subject, '{admin_url}').join()).toContain('{admin_url}');
  });
  it('ссылки с токеном нельзя вставлять в тему', () => {
    expect(templateProblems('order.created', 'customer', '{order_url}', 'x').join()).toContain('нельзя вставлять в тему');
  });
  it('в письме со сбросом пароля обязательна ссылка', () => {
    expect(templateProblems('auth.password_reset', 'customer', 'Сброс', 'просто текст').join()).toContain('{reset_url}');
    expect(templateProblems('auth.password_reset', 'customer', 'Сброс', 'Ссылка: {reset_url}')).toEqual([]);
  });
  it('пустая и слишком длинная тема, тема в несколько строк', () => {
    expect(templateProblems('order.created', 'customer', '', 'x').length).toBeGreaterThan(0);
    expect(templateProblems('order.created', 'customer', 'a'.repeat(201), 'x').length).toBeGreaterThan(0);
    expect(templateProblems('order.created', 'customer', 'a\nb', 'x').length).toBeGreaterThan(0);
  });
  it('нет переменных с полным email и телефоном клиента для менеджеров', () => {
    for (const def of MAIL_EVENTS) for (const v of def.vars) expect(v.key).not.toMatch(/^(email|phone|customer_email|customer_phone)$/);
  });
  it('строка с пустой необязательной переменной пропускается', () => {
    const def = MAIL_EVENTS.find((e) => e.event === 'order.created')!;
    expect(renderTemplateText('A\nСтатус: {order_url}\nB', def, 'customer', { ...def.sample, orderUrl: '' })).toBe('A\nB');
  });
});

describe('включение событий и свои шаблоны влияют на очередь и отправку', () => {
  it('отключённый получатель не получает письма, остальные получают', () => {
    const db = createTestDb();
    mailSettingsAdmin.setEnabled(admin, 'order.created', 'manager', false, { db, now: T0 });
    enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 });
    expect(outboxRows(db).map((r) => r.audience)).toEqual(['customer']);
  });

  it('письма сброса пароля и подтверждения email отключить нельзя', () => {
    const db = createTestDb();
    expect(() => mailSettingsAdmin.setEnabled(admin, 'auth.password_reset', 'customer', false, { db })).toThrow(ConflictError);
    expect(() => mailSettingsAdmin.setEnabled(admin, 'auth.email_confirm', 'customer', false, { db })).toThrow(ConflictError);
  });

  it('приветствие при регистрации по умолчанию выключено и включается', () => {
    const db = createTestDb();
    enqueueMailEvent(db, 'auth.registered', { to: 'a@example.com' }, { now: T0 });
    expect(outboxRows(db)).toHaveLength(0);
    mailSettingsAdmin.setEnabled(admin, 'auth.registered', 'customer', true, { db, now: T0 });
    enqueueMailEvent(db, 'auth.registered', { to: 'a@example.com' }, { now: T0 });
    expect(outboxRows(db)).toHaveLength(1);
  });

  it('свой шаблон задаёт тему в очереди и текст при отправке; сброс возвращает значения из кода', async () => {
    const db = createTestDb();
    mailSettingsAdmin.saveTemplate(admin, { event: 'order.created', audience: 'customer', subject: 'Ваш заказ {order_number} в работе', body: 'Здравствуйте! Заказ {order_number}, сумма {total}.' }, { db, now: T0 });
    enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 });
    expect(outboxRows(db)[0]!.subject).toBe('Ваш заказ RTS-000123 в работе');
    const f = fakePort();
    setRecipients(db, ['boss@example.com']);
    await processOutbox({ db, port: f.port, now: T0 });
    expect(f.sent.find((m) => m.to[0] === 'anna@example.com')).toMatchObject({ text: 'Здравствуйте! Заказ RTS-000123, сумма 1 000 ₽.' });
    mailSettingsAdmin.resetTemplate(admin, 'order.created', 'customer', { db, now: T0 });
    enqueueMailEvent(db, 'order.created', { ...orderCreated, orderNumber: 'RTS-000124' }, { now: T0 });
    expect(outboxRows(db).at(-2)!.subject).toBe('Заказ RTS-000124 принят');
  });

  it('невалидный шаблон не сохраняется', () => {
    const db = createTestDb();
    expect(() => mailSettingsAdmin.saveTemplate(admin, { event: 'order.created', audience: 'customer', subject: 'x', body: '{нет_такой}' }, { db })).toThrow(ValidationError);
    expect(() => mailSettingsAdmin.saveTemplate(admin, { event: 'order.created', audience: 'admin', subject: 'x', body: 'y' }, { db })).toThrow(ValidationError);
    expect(() => mailSettingsAdmin.saveTemplate(admin, { event: 'no.such', audience: 'admin', subject: 'x', body: 'y' }, { db })).toThrow();
  });

  it('предпросмотр рисует тестовые данные и показывает ошибки', () => {
    const db = createTestDb();
    void db;
    const r = mailSettingsAdmin.preview(admin, { event: 'order.created', audience: 'customer', subject: 'Заказ {order_number}', body: 'Итого {total} {oops}' });
    expect(r.subject).toBe('Заказ RTS-000123');
    expect(r.problems.join()).toContain('{oops}');
  });

  it('аудит шаблона не содержит текста письма', () => {
    const db = createTestDb();
    mailSettingsAdmin.saveTemplate(admin, { event: 'order.created', audience: 'customer', subject: 'СЕКРЕТНАЯ-ТЕМА {order_number}', body: 'ТЕЛО-ПИСЬМА {total}' }, { db, now: T0 });
    const dump = JSON.stringify(audit.list({}, { db }));
    expect(dump).toContain('mail.template');
    expect(dump).not.toContain('СЕКРЕТНАЯ');
    expect(dump).not.toContain('ТЕЛО-ПИСЬМА');
  });
});

describe('тестовая отправка: результат берётся из ответа почтового сервиса', () => {
  it('SMTP принял — «успех» и запись о проверке', async () => {
    const db = createTestDb();
    const f = fakePort();
    const r = await mailSettingsAdmin.sendTest(admin, { to: 'me@example.com' }, { db, now: T0, port: f.port });
    expect(r.ok).toBe(true);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ to: ['me@example.com'] });
    expect(db.prepare("SELECT status FROM integration_checks WHERE key = 'mail'").get()).toEqual({ status: 'ok' });
    expect(db.prepare("SELECT status FROM integration_run WHERE kind = 'mail.test'").get()).toEqual({ status: 'ok' });
  });

  it('SMTP вернул ошибку — ошибка, а не успех; секреты вычищены', async () => {
    const db = createTestDb();
    const f = fakePort({ failTimes: 1, error: 'Invalid login for user@example.com: 535 bad password' });
    const r = await mailSettingsAdmin.sendTest(admin, { to: 'me@example.com' }, { db, now: T0 + 100_000, port: f.port });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('user@example.com');
    expect(db.prepare("SELECT status FROM integration_checks WHERE key = 'mail'").get()).toEqual({ status: 'error' });
    expect(db.prepare("SELECT status FROM integration_run WHERE kind = 'mail.test'").get()).toEqual({ status: 'error' });
  });

  it('без SMTP — честное «не отправлено», ничего не уходит', async () => {
    const db = createTestDb();
    const r = await mailSettingsAdmin.sendTest(admin, { to: 'me@example.com' }, { db, now: T0 + 200_000, port: createStubMailPort() });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain('не отправлено');
    expect(db.prepare("SELECT COUNT(*) AS n FROM integration_checks WHERE status = 'ok'").get()).toEqual({ n: 0 });
  });

  it('неверный адрес отклоняется; частые отправки ограничены', async () => {
    const db = createTestDb();
    const f = fakePort();
    await expect(mailSettingsAdmin.sendTest(admin, { to: 'не-адрес' }, { db, port: f.port, now: T0 + 300_000 })).rejects.toThrow(ValidationError);
    await mailSettingsAdmin.sendTest(admin, { to: 'me@example.com' }, { db, port: f.port, now: T0 + 400_000 });
    await expect(mailSettingsAdmin.sendTest(admin, { to: 'me@example.com' }, { db, port: f.port, now: T0 + 400_500 })).rejects.toThrow(RateLimitError);
    expect(f.sent).toHaveLength(1);
  });

  it('тестовая отправка шаблона помечена [ТЕСТ] и использует тестовые данные', async () => {
    const db = createTestDb();
    const f = fakePort();
    await mailSettingsAdmin.sendTest(admin, { to: 'me@example.com', event: 'order.created', audience: 'customer' }, { db, port: f.port, now: T0 + 500_000 });
    expect(f.sent[0]!.subject).toBe('[ТЕСТ] Заказ RTS-000123 принят');
  });
});

describe('журнал отправки и права email.write', () => {
  function seeded() {
    const db = createTestDb();
    enqueueMailEvent(db, 'order.created', orderCreated, { now: T0 });
    enqueueMailEvent(db, 'auth.password_reset', resetPayload, { now: T0 + 86_400_000 });
    db.prepare("UPDATE email_outbox SET status = 'failed', last_error = 'x' WHERE event = 'auth.password_reset'").run();
    return db;
  }
  const page = { limit: 20, offset: 0 };

  it('фильтры: статус, событие, период, текст; адрес клиента замаскирован; пагинация', () => {
    const db = seeded();
    const j = (f: Record<string, unknown>) => mailSettingsAdmin.journal(admin, { ...page, ...f }, { db });
    expect(j({}).total).toBe(3);
    expect(j({ status: 'failed' }).rows.map((r) => r.event)).toEqual(['auth.password_reset']);
    expect(j({ event: 'order.created' }).total).toBe(2);
    expect(j({ from: T0 + 3_600_000 }).total).toBe(1);
    expect(j({ to: T0 + 3_600_000 }).total).toBe(2);
    expect(j({ q: 'ЗАКАЗ' }).total).toBe(2);
    expect(j({ limit: 1, offset: 1 }).rows).toHaveLength(1);
    expect(JSON.stringify(j({}))).not.toContain('anna@example.com');
  });

  it('повтор упавшего письма; payload и тело в журнал не попадают', () => {
    const db = seeded();
    const failed = outboxRows(db).find((r) => r.status === 'failed')!;
    expect(() => mailSettingsAdmin.retry(admin, failed.id, { db, now: T0 })).not.toThrow();
    expect(JSON.stringify(mailSettingsAdmin.journal(admin, { limit: 20, offset: 0 }, { db }))).not.toContain('SECRET-TOKEN');
  });

  it('права: менеджер и аноним отклоняются во всех операциях', async () => {
    const db = createTestDb();
    const o = { db, now: T0, port: fakePort().port };
    expect(() => mailSettingsAdmin.view(manager, o)).toThrow(ForbiddenError);
    expect(() => mailSettingsAdmin.setEnabled(manager, 'order.created', 'manager', false, o)).toThrow(ForbiddenError);
    expect(() => mailSettingsAdmin.saveTemplate(manager, { event: 'order.created', audience: 'customer', subject: 'a', body: 'b' }, o)).toThrow(ForbiddenError);
    expect(() => mailSettingsAdmin.resetTemplate(manager, 'order.created', 'customer', o)).toThrow(ForbiddenError);
    expect(() => mailSettingsAdmin.preview(manager, { event: 'order.created', audience: 'customer', subject: 'a', body: 'b' })).toThrow(ForbiddenError);
    expect(() => mailSettingsAdmin.journal(manager, { limit: 1, offset: 0 }, o)).toThrow(ForbiddenError);
    expect(() => mailSettingsAdmin.retry(manager, 1, o)).toThrow(ForbiddenError);
    await expect(mailSettingsAdmin.sendTest(manager, { to: 'a@b.cc' }, o)).rejects.toThrow(ForbiddenError);
    expect(() => mailSettingsAdmin.view(null, o)).toThrow(UnauthorizedError);
  });

  it('view не раскрывает значений SMTP', () => {
    const db = createTestDb();
    const v = mailSettingsAdmin.view(admin, { db, port: createStubMailPort() });
    expect(Object.keys(v.smtp).sort()).toEqual(['from', 'host', 'lastCheck', 'password', 'port', 'status', 'user']);
    expect(v.events.length).toBe(MAIL_EVENTS.length);
  });
});

const _unused: MailPort | null = null;
void _unused;
