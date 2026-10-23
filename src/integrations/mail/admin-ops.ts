import { audit } from '@/domain/admin/audit';
import { maskEmail } from '@/domain/admin/mask';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, type Db } from '@/server/db/connection';
import { emailOutboxRepo, type OutboxAudience, type OutboxStatus } from '@/server/db/repositories/email-outbox';
import { ConflictError } from '@/server/http/errors';
import type { PortStatus } from '../types';
import { resolveRecipients } from './outbox';
import { selectMailPort } from './ports';
import type { MailPort } from './types';

type Opts = { db?: Db; now?: number; port?: MailPort };

export type MailLogRow = {
  id: number;
  event: string;
  audience: OutboxAudience;
  /** Клиент — замаскированный адрес; менеджеры/админы — null (адреса берутся из настроек при отправке). */
  to: string | null;
  subject: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  sentAt: number | null;
};

export type MailOverview = { status: PortStatus; warnings: string[]; counts: Record<OutboxStatus, number>; rows: MailLogRow[] };

/**
 * Журнал исходящей почты — только admin (право integrations.run). Тело письма и payload сюда не попадают вообще:
 * в ответе тема, статус, замаскированный адресат и очищенный текст ошибки.
 */
export const mailAdmin = {
  overview(session: StaffSession | null, opts: Opts = {}): MailOverview {
    requirePermission(session, 'integrations.run');
    const db = opts.db ?? getDb();
    const port = opts.port ?? selectMailPort();
    const status = port.status();
    const counts = emailOutboxRepo.counts(db);
    const waiting = emailOutboxRepo.countPendingByAudience(db);

    const warnings: string[] = [];
    if (!status.connected) {
      warnings.push(`SMTP не настроен: письма копятся в очереди и не уходят (ожидают: ${counts.pending}). Задайте MAIL_HOST и MAIL_FROM (при необходимости MAIL_PORT, MAIL_USER, MAIL_PASSWORD) на сервере.`);
    }
    if (waiting.manager > 0 && resolveRecipients(db, 'manager').length === 0) {
      warnings.push('Не заданы получатели уведомлений для менеджеров (Доступ и настройки → Настройки): письма о заказах и заявках ждут адресов.');
    }
    if (counts.failed > 0) warnings.push(`Не удалось отправить писем: ${counts.failed}. Причина указана в журнале; письмо можно поставить на повтор.`);

    const rows = emailOutboxRepo.list(db, { limit: 100 }).map<MailLogRow>((r) => ({
      id: r.id,
      event: r.event,
      audience: r.audience,
      to: r.audience === 'customer' && r.toAddr ? maskEmail(r.toAddr) : null,
      subject: r.subject,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
    }));
    return { status, warnings, counts, rows };
  },

  /** Вернуть упавшее письмо в очередь (попытки с нуля). */
  retry(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'integrations.run');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    if (!emailOutboxRepo.requeue(db, id, now)) {
      if (emailOutboxRepo.isPayloadCleared(db, id)) throw new ConflictError('Данные письма очищены, повторить отправку нельзя: создайте событие заново (например, новый запрос сброса пароля)');
      throw new ConflictError('Повторить можно только письмо со статусом «не отправлено»');
    }
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'mail.retry', entity: 'email_outbox', entityId: id }, { db, now });
  },
};
