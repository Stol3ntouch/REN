import type { Db } from '../connection';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refund_pending' | 'refunded' | 'error';

export type PaymentRow = {
  id: number;
  orderId: number;
  provider: string;
  status: PaymentStatus;
  amountKopecks: number;
  currency: string;
  externalId: string;
  redirectUrl: string | null;
  returnUrl: string | null;
  refundedKopecks: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

type Raw = {
  id: number;
  order_id: number;
  provider: string;
  status: PaymentStatus;
  amount_kopecks: number;
  currency: string;
  external_id: string;
  redirect_url: string | null;
  return_url: string | null;
  refunded_kopecks: number;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
};

const map = (r: Raw | undefined): PaymentRow | null =>
  r
    ? {
        id: r.id,
        orderId: r.order_id,
        provider: r.provider,
        status: r.status,
        amountKopecks: r.amount_kopecks,
        currency: r.currency,
        externalId: r.external_id,
        redirectUrl: r.redirect_url,
        returnUrl: r.return_url,
        refundedKopecks: r.refunded_kopecks,
        errorCode: r.error_code,
        errorMessage: r.error_message,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }
    : null;

export const paymentsRepo = {
  insert(
    db: Db,
    p: { orderId: number; provider: string; amountKopecks: number; externalId: string; redirectUrl: string | null; returnUrl: string | null; now: number },
  ): number {
    const r = db
      .prepare(
        `INSERT INTO payments (order_id, provider, status, amount_kopecks, currency, external_id, redirect_url, return_url, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, 'RUB', ?, ?, ?, ?, ?)`,
      )
      .run(p.orderId, p.provider, p.amountKopecks, p.externalId, p.redirectUrl, p.returnUrl, p.now, p.now);
    return Number(r.lastInsertRowid);
  },
  /** Запись о сбое обращения к провайдеру: заказ не теряется, оператор видит ошибку. */
  insertError(
    db: Db,
    p: { orderId: number; provider: string; amountKopecks: number; externalId: string; errorCode: string; errorMessage: string; now: number },
  ): number {
    const r = db
      .prepare(
        `INSERT INTO payments (order_id, provider, status, amount_kopecks, currency, external_id, error_code, error_message, created_at, updated_at)
         VALUES (?, ?, 'error', ?, 'RUB', ?, ?, ?, ?, ?)`,
      )
      .run(p.orderId, p.provider, p.amountKopecks, p.externalId, p.errorCode, p.errorMessage.slice(0, 300), p.now, p.now);
    return Number(r.lastInsertRowid);
  },
  findById(db: Db, id: number): PaymentRow | null {
    return map(db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Raw | undefined);
  },
  findByExternalId(db: Db, provider: string, externalId: string): PaymentRow | null {
    return map(db.prepare('SELECT * FROM payments WHERE provider = ? AND external_id = ?').get(provider, externalId) as Raw | undefined);
  },
  findPendingForOrder(db: Db, orderId: number): PaymentRow | null {
    return map(db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'pending'").get(orderId) as Raw | undefined);
  },
  findPaidForOrder(db: Db, orderId: number): PaymentRow | null {
    return map(
      db.prepare("SELECT * FROM payments WHERE order_id = ? AND status IN ('succeeded','refund_pending') ORDER BY id DESC LIMIT 1").get(orderId) as Raw | undefined,
    );
  },
  listForOrder(db: Db, orderId: number): PaymentRow[] {
    return (db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id').all(orderId) as Raw[]).map((r) => map(r)!);
  },
  /** Ошибки обращения к провайдеру (для журнала ошибок интеграций, T10). */
  listErrors(db: Db, opts: { limit?: number } = {}): PaymentRow[] {
    return (db.prepare("SELECT * FROM payments WHERE status = 'error' ORDER BY id DESC LIMIT ?").all(opts.limit ?? 50) as Raw[]).map((r) => map(r)!);
  },
  /** Меняет статус, только если текущий — один из from. true — строка обновлена (атомарный «захват»). */
  transition(db: Db, id: number, from: PaymentStatus[], to: PaymentStatus, now: number, extra: { refundedKopecks?: number } = {}): boolean {
    const marks = from.map(() => '?').join(',');
    const r = db
      .prepare(`UPDATE payments SET status = ?, updated_at = ?, refunded_kopecks = COALESCE(?, refunded_kopecks) WHERE id = ? AND status IN (${marks})`)
      .run(to, now, extra.refundedKopecks ?? null, id, ...from);
    return Number(r.changes) > 0;
  },
};
