import type { Db } from '../connection';

export type IntegrationRunStatus = 'running' | 'ok' | 'partial' | 'error';
export type IntegrationRunRow = {
  id: number;
  kind: string;
  status: IntegrationRunStatus;
  startedAt: number;
  finishedAt: number | null;
  counts: Record<string, number>;
  errors: string[];
  actor: string;
};

type Raw = { id: number; kind: string; status: IntegrationRunStatus; started_at: number; finished_at: number | null; counts: string; errors: string; actor: string };

export const MAX_RUN_ERRORS = 200;

function parse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const map = (r: Raw): IntegrationRunRow => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  counts: parse(r.counts, {}),
  errors: parse<unknown[]>(r.errors, []).map(String),
  actor: r.actor,
});

export const integrationRunsRepo = {
  start(db: Db, v: { kind: string; actor: string; now: number }): number {
    const r = db.prepare("INSERT INTO integration_run (kind, status, started_at, actor) VALUES (?, 'running', ?, ?)").run(v.kind, v.now, v.actor);
    return Number(r.lastInsertRowid);
  },
  finish(db: Db, id: number, v: { status: Exclude<IntegrationRunStatus, 'running'>; counts: Record<string, number>; errors: string[]; now: number }): void {
    db.prepare('UPDATE integration_run SET status = ?, finished_at = ?, counts = ?, errors = ? WHERE id = ?').run(
      v.status,
      v.now,
      JSON.stringify(v.counts),
      JSON.stringify(v.errors.slice(0, MAX_RUN_ERRORS)),
      id,
    );
  },
  get(db: Db, id: number): IntegrationRunRow | undefined {
    const r = db.prepare('SELECT * FROM integration_run WHERE id = ?').get(id) as Raw | undefined;
    return r && map(r);
  },
  list(db: Db, opts: { kind?: string; limit?: number } = {}): IntegrationRunRow[] {
    const limit = Math.min(opts.limit ?? 30, 200);
    const rows = opts.kind
      ? (db.prepare('SELECT * FROM integration_run WHERE kind = ? ORDER BY id DESC LIMIT ?').all(opts.kind, limit) as Raw[])
      : (db.prepare('SELECT * FROM integration_run ORDER BY id DESC LIMIT ?').all(limit) as Raw[]);
    return rows.map(map);
  },
  /** Число запусков с ошибкой после момента since. */
  countErrorsSince(db: Db, since: number): number {
    return Number((db.prepare("SELECT COUNT(*) AS n FROM integration_run WHERE status IN ('error','partial') AND started_at >= ?").get(since) as { n: number }).n);
  },
};

/** Статусы заказа, при которых заказ уходит в 1С: не ждёт оплаты, не отменён, оплата не провалена. */
const EXPORTABLE = "('new','paid','processing','shipped','ready_for_pickup','delivered','refunded')";
const PENDING_FROM = `FROM orders o WHERE o.status IN ${EXPORTABLE} AND o.number IS NOT NULL AND NOT EXISTS (SELECT 1 FROM onec_exports e WHERE e.order_number = o.number)`;

export const onecExportsRepo = {
  find(db: Db, orderNumber: string): { orderNumber: string; payloadHash: string; exportedAt: number } | undefined {
    const r = db.prepare('SELECT order_number, payload_hash, exported_at FROM onec_exports WHERE order_number = ?').get(orderNumber) as
      | { order_number: string; payload_hash: string; exported_at: number }
      | undefined;
    return r && { orderNumber: r.order_number, payloadHash: r.payload_hash, exportedAt: r.exported_at };
  },
  /** INSERT OR IGNORE: повторная запись того же заказа ничего не меняет. */
  insert(db: Db, v: { orderNumber: string; orderId: number; fileName: string; payloadHash: string; now: number }): void {
    db.prepare('INSERT OR IGNORE INTO onec_exports (order_number, order_id, file_name, payload_hash, exported_at) VALUES (?, ?, ?, ?, ?)').run(
      v.orderNumber,
      v.orderId,
      v.fileName,
      v.payloadHash,
      v.now,
    );
  },
  count(db: Db): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM onec_exports').get() as { n: number }).n);
  },
  /** Номера заказов, готовых к выгрузке и ещё не выгруженных (старые первыми). */
  listPendingNumbers(db: Db, limit = 200): string[] {
    return (db.prepare(`SELECT o.number AS number ${PENDING_FROM} ORDER BY o.id LIMIT ?`).all(limit) as { number: string }[]).map((r) => r.number);
  },
  countPending(db: Db): number {
    return Number((db.prepare(`SELECT COUNT(*) AS n ${PENDING_FROM}`).get() as { n: number }).n);
  },
};
