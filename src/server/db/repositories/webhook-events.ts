import type { Db } from '../connection';

export type WebhookOutcome = 'received' | 'processed' | 'ignored' | 'alert' | 'error';

export type WebhookEventRow = {
  id: number;
  provider: string;
  eventId: string;
  eventType: string;
  paymentExternalId: string | null;
  orderId: number | null;
  outcome: WebhookOutcome;
  detail: string | null;
  receivedAt: number;
  processedAt: number | null;
};

type Raw = {
  id: number;
  provider: string;
  event_id: string;
  event_type: string;
  payment_external_id: string | null;
  order_id: number | null;
  outcome: WebhookOutcome;
  detail: string | null;
  received_at: number;
  processed_at: number | null;
};

const map = (r: Raw): WebhookEventRow => ({
  id: r.id,
  provider: r.provider,
  eventId: r.event_id,
  eventType: r.event_type,
  paymentExternalId: r.payment_external_id,
  orderId: r.order_id,
  outcome: r.outcome,
  detail: r.detail,
  receivedAt: r.received_at,
  processedAt: r.processed_at,
});

/** Итоговые исходы: повтор события с таким исходом отвечает 200 без повторной обработки. */
const FINAL: WebhookOutcome[] = ['processed', 'ignored', 'alert'];

export const webhookEventsRepo = {
  /**
   * Занять event id. 'new' — первое получение; 'duplicate' — уже обработано (итоговый исход);
   * 'retry' — прошлая обработка не завершилась (received/error), обработать заново (шаги идемпотентны).
   */
  claim(
    db: Db,
    e: { provider: string; eventId: string; eventType: string; paymentExternalId: string; orderId: number | null; now: number },
  ): 'new' | 'duplicate' | 'retry' {
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO webhook_events (provider, event_id, event_type, payment_external_id, order_id, outcome, received_at)
         VALUES (?, ?, ?, ?, ?, 'received', ?)`,
      )
      .run(e.provider, e.eventId, e.eventType, e.paymentExternalId, e.orderId, e.now);
    if (Number(r.changes) > 0) return 'new';
    const existing = webhookEventsRepo.find(db, e.provider, e.eventId);
    return existing && FINAL.includes(existing.outcome) ? 'duplicate' : 'retry';
  },
  find(db: Db, provider: string, eventId: string): WebhookEventRow | null {
    const r = db.prepare('SELECT * FROM webhook_events WHERE provider = ? AND event_id = ?').get(provider, eventId) as Raw | undefined;
    return r ? map(r) : null;
  },
  finish(db: Db, provider: string, eventId: string, outcome: WebhookOutcome, detail: string | null, now: number): void {
    db.prepare('UPDATE webhook_events SET outcome = ?, detail = ?, processed_at = ? WHERE provider = ? AND event_id = ?').run(
      outcome,
      detail ? detail.slice(0, 300) : null,
      now,
      provider,
      eventId,
    );
  },
  /** События, требующие внимания оператора (alert/error), новые сверху. */
  listAttention(db: Db, opts: { limit?: number } = {}): WebhookEventRow[] {
    return (db.prepare("SELECT * FROM webhook_events WHERE outcome IN ('alert','error') ORDER BY id DESC LIMIT ?").all(opts.limit ?? 50) as Raw[]).map(map);
  },
  listForOrder(db: Db, orderId: number): WebhookEventRow[] {
    return (db.prepare('SELECT * FROM webhook_events WHERE order_id = ? ORDER BY id').all(orderId) as Raw[]).map(map);
  },
  countByOutcome(db: Db, outcome: WebhookOutcome): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM webhook_events WHERE outcome = ?').get(outcome) as { n: number }).n);
  },
};
