import { createHash } from 'node:crypto';
import { getConfig } from '@/server/config';
import type { Db } from '@/server/db/connection';
import { emailOutboxRepo, type OutboxAudience } from '@/server/db/repositories/email-outbox';
import { adminFlagsRepo, staffAdminRepo } from '@/server/db/repositories/staff-admin';
import { effectiveSubject, isMailEnabled } from './settings';
import { isKnownMailEvent, planMessages, type Payload } from './templates';

/** Стабильная сериализация: порядок ключей не влияет на ключ дедупликации. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * Ставит событие в email_outbox: по строке на адресата-группу (клиент / менеджеры / админы).
 * Одинаковое событие с одинаковыми данными второй раз не создаёт письма (UNIQUE dedupe_key).
 * Адреса менеджеров и админов подбираются при отправке, поэтому очередь копится и без настроек.
 */
export function enqueueMailEvent(db: Db, event: string, payload: Payload, opts: { now?: number } = {}): { queued: number } {
  if (!isKnownMailEvent(event)) return { queued: 0 };
  const now = opts.now ?? Date.now();
  let queued = 0;
  for (const m of planMessages(event, payload)) {
    // C12: событие × получатель можно отключить в настройках; свой шаблон задаёт тему
    if (!isMailEnabled(db, event, m.audience)) continue;
    const subject = effectiveSubject(db, event, m.audience, payload, m.subject);
    const dedupeKey = createHash('sha256').update(`${event}|${m.audience}|${m.to ?? ''}|${canonical(payload)}`).digest('hex');
    const inserted = emailOutboxRepo.insertIfNew(db, {
      event,
      audience: m.audience,
      toAddr: m.to,
      subject,
      payloadJson: JSON.stringify(payload),
      dedupeKey,
      now,
    });
    if (inserted) queued += 1;
  }
  return { queued };
}

/** Получатели группы. Менеджеры: настройка «получатели уведомлений» (T10), запасной вариант — MAIL_TO. Админы: активные сотрудники с ролью admin. */
export function resolveRecipients(db: Db, audience: OutboxAudience): string[] {
  if (audience === 'manager') {
    const configured = adminFlagsRepo.getRecipients(db);
    if (configured.length > 0) return configured;
    try {
      return (getConfig().mail.to ?? '')
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter((x) => x.includes('@'));
    } catch {
      return [];
    }
  }
  if (audience === 'admin') {
    return staffAdminRepo
      .list(db)
      .filter((s) => (s.role === 'admin' || s.role === 'super_admin') && s.active)
      .map((s) => s.email);
  }
  return [];
}
