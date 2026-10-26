import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { maskEmail } from '@/domain/admin/mask';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getConfig } from '@/server/config';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { emailOutboxRepo, type OutboxStatus } from '@/server/db/repositories/email-outbox';
import { emailTemplatesRepo, type StoredTemplate } from '@/server/db/repositories/email-templates';
import { integrationChecksRepo } from '@/server/db/repositories/integration-settings';
import { integrationRunsRepo } from '@/server/db/repositories/integration-runs';
import { ConflictError, NotFoundError, RateLimitError, ValidationError } from '@/server/http/errors';
import type { PortStatus } from '../types';
import { fingerprintOf } from '../registry';
import { selectMailPort, mailSecrets } from './ports';
import { DEFAULT_TEMPLATES, MAIL_EVENTS, eventDef, isMailEnabled, renderTemplateText, sampleFor, templateProblems, type EventDef, type MailAudience } from './settings';
import { sanitizeMailError } from './worker';
import { MailNotConfiguredError, type MailPort } from './types';

type Opts = { db?: Db; now?: number; port?: MailPort };

const audienceSchema = z.enum(['customer', 'manager', 'admin'], { error: 'Неизвестный получатель' });

function checkEvent(event: string, audience: MailAudience): EventDef {
  const def = eventDef(event);
  if (!def) throw new NotFoundError('Событие не найдено');
  if (!def.audiences.includes(audience)) throw new ValidationError('Для этого события такого получателя нет');
  return def;
}

export type EventRow = {
  event: string;
  label: string;
  description: string;
  audiences: {
    audience: MailAudience;
    enabled: boolean;
    locked: boolean;
    custom: boolean;
    subject: string;
    body: string;
    defaultSubject: string;
    defaultBody: string;
    vars: { key: string; label: string; optional: boolean; link: boolean }[];
  }[];
};

/** Состояние SMTP для интерфейса: только «задан / не задан» и порт; пароль, пользователь и хост не показываются. */
export type SmtpView = { status: PortStatus; host: boolean; from: boolean; user: boolean; password: boolean; port: number | null; lastCheck: { ok: boolean; at: number; message: string | null } | null };

const TEST_INTERVAL_MS = 10_000;
const g = globalThis as unknown as { __rtsMailTestAt?: Map<number, number> };
const lastTest = (g.__rtsMailTestAt ??= new Map());

export type TestSendResult = { ok: true; message: string } | { ok: false; error: string };

export const mailSettingsAdmin = {
  view(session: StaffSession | null, opts: Opts = {}): { events: EventRow[]; smtp: SmtpView; counts: Record<OutboxStatus, number> } {
    requirePermission(session, 'email.write');
    const db = opts.db ?? getDb();
    const port = opts.port ?? selectMailPort();
    const stored = new Map<string, StoredTemplate>(emailTemplatesRepo.listTemplates(db).map((t) => [`${t.event}|${t.audience}`, t]));
    const events = MAIL_EVENTS.map<EventRow>((def) => ({
      event: def.event,
      label: def.label,
      description: def.description,
      audiences: def.audiences.map((audience) => {
        const d = DEFAULT_TEMPLATES[def.event]?.[audience] ?? { subject: '', body: '' };
        const t = stored.get(`${def.event}|${audience}`);
        return {
          audience,
          enabled: isMailEnabled(db, def.event, audience),
          locked: def.locked?.includes(audience) ?? false,
          custom: !!t,
          subject: t?.subject ?? d.subject,
          body: t?.body ?? d.body,
          defaultSubject: d.subject,
          defaultBody: d.body,
          vars: def.vars.filter((v) => v.audiences.includes(audience)).map((v) => ({ key: v.key, label: v.label, optional: !!v.optional, link: !!v.link })),
        };
      }),
    }));
    let mail: { host?: string; port?: number; user?: string; password?: string; from?: string } = {};
    try {
      mail = getConfig().mail;
    } catch {
      /* конфигурация недоступна */
    }
    const check = integrationChecksRepo.get(db, 'mail');
    return {
      events,
      smtp: {
        status: port.status(),
        host: !!mail.host,
        from: !!mail.from,
        user: !!mail.user,
        password: !!mail.password,
        port: mail.port ?? null,
        lastCheck: check ? { ok: check.status === 'ok', at: check.checkedAt, message: check.message } : null,
      },
      counts: emailOutboxRepo.counts(db),
    };
  },

  setEnabled(session: StaffSession | null, event: string, audience: string, enabled: boolean, opts: Opts = {}): void {
    requirePermission(session, 'email.write');
    const a = audienceSchema.safeParse(audience);
    if (!a.success) throw new ValidationError('Неизвестный получатель');
    const def = checkEvent(event, a.data);
    if (def.locked?.includes(a.data)) throw new ConflictError('Это письмо отключить нельзя: без него функция не работает');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = isMailEnabled(db, event, a.data);
      emailTemplatesRepo.setEnabled(db, event, a.data, enabled, now);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'mail.toggle', entity: 'mail_event', entityId: `${event}:${a.data}`, before: { enabled: before }, after: { enabled } }, { db, now });
    });
  },

  saveTemplate(session: StaffSession | null, input: { event: string; audience: string; subject: string; body: string }, opts: Opts = {}): void {
    requirePermission(session, 'email.write');
    const a = audienceSchema.safeParse(input.audience);
    if (!a.success) throw new ValidationError('Неизвестный получатель');
    checkEvent(input.event, a.data);
    const subject = (input.subject ?? '').trim();
    const body = (input.body ?? '').replace(/\r\n/g, '\n').trim();
    const problems = templateProblems(input.event, a.data, subject, body);
    if (problems.length > 0) throw new ValidationError(problems[0] as string, { template: problems });
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      emailTemplatesRepo.saveTemplate(db, { event: input.event, audience: a.data, subject, body, now, staffId: session.staffId });
      // В аудит — без текста письма: только факт и длина.
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'mail.template', entity: 'mail_event', entityId: `${input.event}:${a.data}`, after: { subjectLength: subject.length, bodyLength: body.length } }, { db, now });
    });
  },

  resetTemplate(session: StaffSession | null, event: string, audience: string, opts: Opts = {}): void {
    requirePermission(session, 'email.write');
    const a = audienceSchema.safeParse(audience);
    if (!a.success) throw new ValidationError('Неизвестный получатель');
    checkEvent(event, a.data);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      if (emailTemplatesRepo.deleteTemplate(db, event, a.data)) {
        audit.record({ actorId: session.staffId, actorType: 'staff', action: 'mail.template_reset', entity: 'mail_event', entityId: `${event}:${a.data}` }, { db, now });
      }
    });
  },

  /** Предпросмотр на тестовых данных (в них нет настоящих клиентов). Ошибки шаблона возвращаются списком. */
  preview(session: StaffSession | null, input: { event: string; audience: string; subject: string; body: string }): { subject: string; body: string; problems: string[] } {
    requirePermission(session, 'email.write');
    const a = audienceSchema.safeParse(input.audience);
    if (!a.success) throw new ValidationError('Неизвестный получатель');
    const def = checkEvent(input.event, a.data);
    const problems = templateProblems(input.event, a.data, input.subject ?? '', input.body ?? '');
    return {
      subject: renderTemplateText(input.subject ?? '', def, a.data, sampleFor(def, a.data)).replace(/\s+/g, ' ').trim(),
      body: renderTemplateText(input.body ?? '', def, a.data, sampleFor(def, a.data)),
      problems,
    };
  },

  /**
   * Тестовая отправка. Результат берётся из ответа почтового сервиса: ошибка SMTP показывается как ошибка,
   * «успех» — только если сервер принял письмо. Без SMTP письмо никуда не уходит, и об этом сказано прямо.
   */
  async sendTest(session: StaffSession | null, input: { to: string; event?: string; audience?: string }, opts: Opts = {}): Promise<TestSendResult> {
    requirePermission(session, 'email.write');
    const to = z.string().trim().pipe(z.email('Неверный адрес получателя')).safeParse(input.to ?? '');
    if (!to.success) throw new ValidationError(to.error.issues[0]?.message ?? 'Неверный адрес получателя', { to: ['Неверный адрес получателя'] });
    let subject = 'Тестовое письмо «РемТехСад»';
    let text = 'Это тестовое письмо из настроек почты. Если вы его видите, SMTP-сервер принял сообщение.\n\n— РемТехСад';
    if (input.event) {
      const a = audienceSchema.safeParse(input.audience);
      if (!a.success) throw new ValidationError('Неизвестный получатель');
      const def = checkEvent(input.event, a.data);
      const t = emailTemplatesRepo.findTemplate(opts.db ?? getDb(), input.event, a.data);
      const d = DEFAULT_TEMPLATES[input.event]?.[a.data];
      subject = `[ТЕСТ] ${renderTemplateText(t?.subject ?? d?.subject ?? '', def, a.data, sampleFor(def, a.data)).replace(/\s+/g, ' ').trim()}`;
      text = `${renderTemplateText(t?.body ?? d?.body ?? '', def, a.data, sampleFor(def, a.data))}\n\n(Тестовые данные: письмо отправлено из настроек.)`;
    }
    const now = opts.now ?? Date.now();
    const last = lastTest.get(session.staffId);
    if (last !== undefined && now - last < TEST_INTERVAL_MS && now >= last) throw new RateLimitError(Math.ceil((TEST_INTERVAL_MS - (now - last)) / 1000), 'Тестовое письмо можно отправлять не чаще раза в 10 секунд');
    lastTest.set(session.staffId, now);

    const db = opts.db ?? getDb();
    const port = opts.port ?? selectMailPort();
    const runId = integrationRunsRepo.start(db, { kind: 'mail.test', actor: `staff:${session.staffId}`, now });
    const finish = (ok: boolean, error: string | null) => {
      integrationRunsRepo.finish(db, runId, { status: ok ? 'ok' : 'error', counts: { sent: ok ? 1 : 0 }, errors: error ? [error] : [], now });
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'mail.test', entity: 'mail', entityId: maskEmail(to.data), result: ok ? 'ok' : 'error' }, { db, now });
    };
    if (!port.status().connected) {
      finish(false, 'SMTP не настроен');
      return { ok: false, error: 'SMTP не настроен: письмо не отправлено. Задайте MAIL_HOST и MAIL_FROM на сервере — до этого письма копятся в очереди.' };
    }
    try {
      await port.send({ to: [to.data], subject, text });
      finish(true, null);
      integrationChecksRepo.save(db, { key: 'mail', status: 'ok', message: 'Тестовое письмо принято SMTP-сервером', fingerprint: fingerprintOf('mail'), now, staffId: session.staffId });
      return { ok: true, message: 'SMTP-сервер принял письмо. Доставка во входящие от него уже не зависит — проверьте почту получателя.' };
    } catch (e) {
      if (e instanceof MailNotConfiguredError) {
        finish(false, 'SMTP не настроен');
        return { ok: false, error: 'SMTP не настроен: письмо не отправлено.' };
      }
      const error = sanitizeMailError(e, mailSecrets());
      finish(false, error);
      integrationChecksRepo.save(db, { key: 'mail', status: 'error', message: error, fingerprint: fingerprintOf('mail'), now, staffId: session.staffId });
      return { ok: false, error: `Письмо не отправлено: ${error}` };
    }
  },

  /** Журнал отправки: без тела письма; адрес клиента замаскирован. */
  journal(
    session: StaffSession | null,
    f: { status?: OutboxStatus; event?: string; from?: number; to?: number; q?: string; limit: number; offset: number },
    opts: Opts = {},
  ) {
    requirePermission(session, 'email.write');
    const db = opts.db ?? getDb();
    const res = emailTemplatesRepo.logSearch(db, f);
    return {
      total: res.total,
      rows: res.rows.map((r) => ({ ...r, toAddr: r.audience === 'customer' && r.toAddr ? maskEmail(r.toAddr) : null })),
    };
  },

  retry(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'email.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    if (!emailOutboxRepo.requeue(db, id, now)) {
      if (emailOutboxRepo.isPayloadCleared(db, id)) throw new ConflictError('Данные письма очищены, повторить отправку нельзя: создайте событие заново (например, новый запрос сброса пароля)');
      throw new ConflictError('Повторить можно только письмо со статусом «не отправлено»');
    }
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'mail.retry', entity: 'email_outbox', entityId: id }, { db, now });
  },
};
