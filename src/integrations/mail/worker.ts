import { maskPii } from '@/domain/admin/mask';
import type { Db } from '@/server/db/connection';
import { emailOutboxRepo } from '@/server/db/repositories/email-outbox';
import { resolveRecipients } from './outbox';
import { customBody } from './settings';
import { missingPayloadFields, renderBody, type Payload } from './templates';
import { MailNotConfiguredError, type MailPort } from './types';

/** Всего попыток отправки одного письма (первая + повторы). После третьей неудачи письмо получает статус failed. */
export const MAX_ATTEMPTS = 3;
/** Задержка перед повтором после 1-й и 2-й неудачи. */
export const RETRY_DELAYS_MS = [60_000, 300_000] as const;
const STALE_SENDING_MS = 10 * 60_000;
const DEFER_MS = 30_000;
const BATCH = 50;

export type ProcessResult = { sent: number; failed: number; retried: number; deferred: number };

/** Текст ошибки для журнала: без секретов SMTP, без email и телефонов, без переводов строк, не длиннее 300 знаков. */
export function sanitizeMailError(err: unknown, secrets: string[] = []): string {
  let text = err instanceof Error ? err.message : String(err);
  for (const secret of secrets) if (secret) text = text.split(secret).join('***');
  text = maskPii(text).replace(/\s+/g, ' ').trim();
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

/**
 * Один проход по очереди: берёт созревшие письма, отправляет через MailPort и обновляет статус.
 * Письмо «забирается» атомарно (pending → sending), поэтому повторный или параллельный проход его не продублирует.
 * Нет SMTP или нет получателей — письмо остаётся в очереди, попытка не тратится.
 */
export async function processOutbox(o: { db: Db; port: MailPort; now?: number; secrets?: string[] }): Promise<ProcessResult> {
  const { db, port } = o;
  const now = o.now ?? Date.now();
  const res: ProcessResult = { sent: 0, failed: 0, retried: 0, deferred: 0 };

  emailOutboxRepo.releaseStale(db, now - STALE_SENDING_MS);
  const live = port.status().connected;

  for (const id of emailOutboxRepo.dueIds(db, now, BATCH)) {
    if (!emailOutboxRepo.claim(db, id, now)) continue;
    const job = emailOutboxRepo.getJob(db, id);
    if (!job) continue;

    if (!live) {
      emailOutboxRepo.defer(db, id, { reason: 'SMTP не настроен', retryAt: now + DEFER_MS });
      res.deferred += 1;
      continue;
    }

    let payload: Payload = {};
    try {
      const parsed: unknown = JSON.parse(job.payloadJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Payload;
    } catch {
      /* битый payload: ниже письмо закроется как неотправляемое */
    }
    // Очищенный (после отправки/закрытия) или неполный payload дал бы пустое письмо: терминальный failed с причиной.
    const missing = missingPayloadFields(job.event, payload);
    if (missing.length > 0) {
      emailOutboxRepo.markDropped(db, id, 'Данные письма пусты или неполны — письмо не отправлено');
      res.failed += 1;
      continue;
    }
    if (job.event === 'auth.password_reset' && typeof payload.expiresAt === 'number' && payload.expiresAt < now) {
      emailOutboxRepo.markDropped(db, id, 'Ссылка для сброса пароля просрочена — письмо не отправлено');
      res.failed += 1;
      continue;
    }

    const to = job.audience === 'customer' ? (job.toAddr ? [job.toAddr] : []) : resolveRecipients(db, job.audience);
    if (to.length === 0) {
      emailOutboxRepo.defer(db, id, { reason: 'Не заданы получатели уведомлений', retryAt: now + DEFER_MS });
      res.deferred += 1;
      continue;
    }

    try {
      await port.send({ to, subject: job.subject, text: customBody(db, job.event, job.audience, payload) ?? renderBody(job.event, job.audience, payload) });
      emailOutboxRepo.markSent(db, id, now);
      res.sent += 1;
    } catch (e) {
      if (e instanceof MailNotConfiguredError) {
        emailOutboxRepo.defer(db, id, { reason: 'SMTP не настроен', retryAt: now + DEFER_MS });
        res.deferred += 1;
        continue;
      }
      const error = sanitizeMailError(e, o.secrets);
      const attempt = job.attempts + 1;
      const last = attempt >= MAX_ATTEMPTS;
      emailOutboxRepo.markFailure(db, id, { error, retryAt: last ? null : now + (RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[1]), now });
      console.warn(`[mail] письмо #${id} (${job.event}): попытка ${attempt} из ${MAX_ATTEMPTS} не удалась: ${error}`);
      if (last) res.failed += 1;
      else res.retried += 1;
    }
  }
  return res;
}
