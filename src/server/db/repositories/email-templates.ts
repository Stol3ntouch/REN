import type { Db } from '../connection';
import { ensureLowerFn } from './content-base';
import type { OutboxAudience, OutboxStatus, OutboxView } from './email-outbox';

export type StoredTemplate = { event: string; audience: OutboxAudience; subject: string; body: string; updatedAt: number; updatedBy: number | null };

type RawT = { event: string; audience: OutboxAudience; subject: string; body: string; updated_at: number; updated_by: number | null };

export const emailTemplatesRepo = {
  /** Свои шаблоны (нет строки — действует значение по умолчанию из кода). */
  listTemplates(db: Db): StoredTemplate[] {
    return (db.prepare('SELECT event, audience, subject, body, updated_at, updated_by FROM email_templates ORDER BY event, audience').all() as RawT[]).map((r) => ({
      event: r.event,
      audience: r.audience,
      subject: r.subject,
      body: r.body,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    }));
  },
  findTemplate(db: Db, event: string, audience: OutboxAudience): StoredTemplate | null {
    const r = db.prepare('SELECT event, audience, subject, body, updated_at, updated_by FROM email_templates WHERE event = ? AND audience = ?').get(event, audience) as RawT | undefined;
    return r ? { event: r.event, audience: r.audience, subject: r.subject, body: r.body, updatedAt: r.updated_at, updatedBy: r.updated_by } : null;
  },
  saveTemplate(db: Db, t: { event: string; audience: OutboxAudience; subject: string; body: string; now: number; staffId: number | null }): void {
    db.prepare(
      `INSERT INTO email_templates (event, audience, subject, body, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event, audience) DO UPDATE SET subject = excluded.subject, body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(t.event, t.audience, t.subject, t.body, t.now, t.staffId);
  },
  deleteTemplate(db: Db, event: string, audience: OutboxAudience): boolean {
    return Number(db.prepare('DELETE FROM email_templates WHERE event = ? AND audience = ?').run(event, audience).changes) > 0;
  },

  /** Переопределённые включения; нет строки — включено (или значение по умолчанию события). */
  listEnabled(db: Db): { event: string; audience: OutboxAudience; enabled: boolean }[] {
    return (db.prepare('SELECT event, audience, enabled FROM email_event_settings').all() as { event: string; audience: OutboxAudience; enabled: number }[]).map((r) => ({
      event: r.event,
      audience: r.audience,
      enabled: r.enabled === 1,
    }));
  },
  findEnabled(db: Db, event: string, audience: OutboxAudience): boolean | null {
    const r = db.prepare('SELECT enabled FROM email_event_settings WHERE event = ? AND audience = ?').get(event, audience) as { enabled: number } | undefined;
    return r ? r.enabled === 1 : null;
  },
  setEnabled(db: Db, event: string, audience: OutboxAudience, enabled: boolean, now: number): void {
    db.prepare(
      `INSERT INTO email_event_settings (event, audience, enabled, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(event, audience) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    ).run(event, audience, enabled ? 1 : 0, now);
  },

  /** Журнал отправки (без тела и payload) с фильтрами и пагинацией. */
  logSearch(
    db: Db,
    f: { status?: OutboxStatus; event?: string; /** ISO-подобные границы в unix-мс */ from?: number; to?: number; q?: string; limit: number; offset: number },
  ): { rows: OutboxView[]; total: number } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.status) {
      where.push('status = ?');
      args.push(f.status);
    }
    if (f.event) {
      where.push('event = ?');
      args.push(f.event);
    }
    if (f.from !== undefined) {
      where.push('created_at >= ?');
      args.push(f.from);
    }
    if (f.to !== undefined) {
      where.push('created_at < ?');
      args.push(f.to);
    }
    if (f.q) {
      ensureLowerFn(db);
      where.push("rts_lc(subject) LIKE ? ESCAPE '\\'");
      args.push(`%${f.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    const w = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM email_outbox ${w}`).get(...args) as { n: number }).n);
    const rows = (
      db
        .prepare(`SELECT id, event, audience, to_addr, subject, status, attempts, next_attempt_at, last_error, created_at, sent_at FROM email_outbox ${w} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(...args, f.limit, f.offset) as {
        id: number;
        event: string;
        audience: OutboxAudience;
        to_addr: string | null;
        subject: string;
        status: OutboxStatus;
        attempts: number;
        next_attempt_at: number;
        last_error: string | null;
        created_at: number;
        sent_at: number | null;
      }[]
    ).map<OutboxView>((r) => ({
      id: r.id,
      event: r.event,
      audience: r.audience,
      toAddr: r.to_addr,
      subject: r.subject,
      status: r.status,
      attempts: r.attempts,
      nextAttemptAt: r.next_attempt_at,
      lastError: r.last_error,
      createdAt: r.created_at,
      sentAt: r.sent_at,
    }));
    return { rows, total };
  },
};
