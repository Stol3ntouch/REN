import type { Db } from '../connection';

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed';
export type OutboxAudience = 'customer' | 'manager' | 'admin';

/** Строка журнала БЕЗ тела письма и payload: админка их не получает вовсе. */
export type OutboxView = {
  id: number;
  event: string;
  audience: OutboxAudience;
  toAddr: string | null;
  subject: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
  sentAt: number | null;
};

/** Строка для воркера: с payload (нужен, чтобы собрать тело). */
export type OutboxJob = OutboxView & { payloadJson: string };

type Raw = {
  id: number;
  event: string;
  audience: OutboxAudience;
  to_addr: string | null;
  subject: string;
  payload_json: string;
  status: OutboxStatus;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  created_at: number;
  sent_at: number | null;
};

const view = (r: Raw): OutboxView => ({
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
});

const VIEW_COLUMNS = 'id, event, audience, to_addr, subject, status, attempts, next_attempt_at, last_error, created_at, sent_at';

export const emailOutboxRepo = {
  /** Вставка без дублей: тот же dedupe_key второй раз не создаёт строку. true — вставлено. */
  insertIfNew(db: Db, v: { event: string; audience: OutboxAudience; toAddr: string | null; subject: string; payloadJson: string; dedupeKey: string; now: number }): boolean {
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO email_outbox (event, audience, to_addr, subject, payload_json, dedupe_key, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(v.event, v.audience, v.toAddr, v.subject, v.payloadJson, v.dedupeKey, v.now, v.now);
    return Number(r.changes) === 1;
  },
  /** Вернуть «зависшие» sending (процесс упал посреди отправки) в pending. */
  releaseStale(db: Db, olderThan: number): number {
    return Number(db.prepare("UPDATE email_outbox SET status = 'pending', locked_at = NULL WHERE status = 'sending' AND locked_at < ?").run(olderThan).changes);
  },
  /** id писем, которым пора на отправку. */
  dueIds(db: Db, now: number, limit: number): number[] {
    return (db.prepare("SELECT id FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT ?").all(now, limit) as { id: number }[]).map((r) => r.id);
  },
  /** Атомарно «забрать» письмо: pending → sending. false — уже взято/отправлено (защита от дублей). */
  claim(db: Db, id: number, now: number): boolean {
    return Number(db.prepare("UPDATE email_outbox SET status = 'sending', locked_at = ? WHERE id = ? AND status = 'pending'").run(now, id).changes) === 1;
  },
  getJob(db: Db, id: number): OutboxJob | null {
    const r = db.prepare('SELECT * FROM email_outbox WHERE id = ?').get(id) as Raw | undefined;
    return r ? { ...view(r), payloadJson: r.payload_json } : null;
  },
  /** Успех: статус sent, payload очищен (в нём могла быть ссылка-токен). */
  markSent(db: Db, id: number, now: number): void {
    db.prepare("UPDATE email_outbox SET status = 'sent', sent_at = ?, attempts = attempts + 1, payload_json = '{}', last_error = NULL, locked_at = NULL WHERE id = ?").run(now, id);
  },
  /** Сбой: ещё остались попытки → pending с задержкой, иначе failed. */
  markFailure(db: Db, id: number, v: { error: string; retryAt: number | null; now: number }): void {
    if (v.retryAt === null) {
      db.prepare("UPDATE email_outbox SET status = 'failed', attempts = attempts + 1, last_error = ?, locked_at = NULL WHERE id = ?").run(v.error, id);
    } else {
      db.prepare("UPDATE email_outbox SET status = 'pending', attempts = attempts + 1, last_error = ?, next_attempt_at = ?, locked_at = NULL WHERE id = ?").run(v.error, v.retryAt, id);
    }
  },
  /** Вернуть письмо в очередь без траты попытки (нет SMTP / нет получателей): ничего не потеряно. */
  defer(db: Db, id: number, v: { reason: string; retryAt: number }): void {
    db.prepare("UPDATE email_outbox SET status = 'pending', last_error = ?, next_attempt_at = ?, locked_at = NULL WHERE id = ?").run(v.reason, v.retryAt, id);
  },
  /** Терминально закрыть без отправки (например, ссылка сброса просрочена). Payload очищается. */
  markDropped(db: Db, id: number, reason: string): void {
    db.prepare("UPDATE email_outbox SET status = 'failed', last_error = ?, payload_json = '{}', locked_at = NULL WHERE id = ?").run(reason, id);
  },
  /** Ручной повтор из админки: failed → pending, счётчик попыток с нуля. */
  requeue(db: Db, id: number, now: number): boolean {
    return Number(db.prepare("UPDATE email_outbox SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL WHERE id = ? AND status = 'failed'").run(now, id).changes) === 1;
  },
  list(db: Db, f: { status?: OutboxStatus; limit?: number; offset?: number } = {}): OutboxView[] {
    const sql = `SELECT ${VIEW_COLUMNS} FROM email_outbox ${f.status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT ? OFFSET ?`;
    const args: (string | number)[] = f.status ? [f.status] : [];
    return (db.prepare(sql).all(...args, f.limit ?? 100, f.offset ?? 0) as Raw[]).map(view);
  },
  counts(db: Db): Record<OutboxStatus, number> {
    const out: Record<OutboxStatus, number> = { pending: 0, sending: 0, sent: 0, failed: 0 };
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM email_outbox GROUP BY status').all() as { status: OutboxStatus; n: number }[]) out[r.status] = Number(r.n);
    return out;
  },
  /** Сколько писем для менеджеров/админа ждут (нет получателей или нет SMTP). */
  countPendingByAudience(db: Db): Record<OutboxAudience, number> {
    const out: Record<OutboxAudience, number> = { customer: 0, manager: 0, admin: 0 };
    for (const r of db.prepare("SELECT audience, COUNT(*) AS n FROM email_outbox WHERE status = 'pending' GROUP BY audience").all() as { audience: OutboxAudience; n: number }[]) {
      out[r.audience] = Number(r.n);
    }
    return out;
  },
};
