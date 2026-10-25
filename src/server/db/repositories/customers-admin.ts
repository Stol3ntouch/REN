import type { Db } from '../connection';

export const CUSTOMER_STATUSES = ['active', 'vip', 'blocked'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const CUSTOMER_SORT_KEYS = ['registered', 'name', 'orders', 'spent'] as const;
export type CustomerSortKey = (typeof CUSTOMER_SORT_KEYS)[number];

/** Покупатель для админки: контакты и итоги по заказам. Хеш пароля и сессии сюда не попадают. */
export type CustomerRow = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  createdAt: number;
  lastLoginAt: number | null;
  ordersCount: number;
  /** Сумма покупок, копейки: заказы без отменённых, возвращённых и с ошибкой оплаты. */
  spentKopecks: number;
  status: CustomerStatus;
};

export type CustomerOrderRow = { id: number; number: string; status: string; totalKopecks: number; isPaid: boolean; createdAt: number };
export type CustomerNoteRow = { id: number; userId: number; staffId: number | null; authorName: string | null; body: string; createdAt: number };
export type CustomerConsentRow = { id: number; kind: string; source: string; grantedAt: number };
export type CustomerAddressRow = { id: number; label: string | null; address: string };

export type CustomerFilter = {
  q?: string;
  status?: CustomerStatus;
  /** Регистрация: границы unix-мс, to — не включая. */
  from?: number;
  to?: number;
  hasOrders?: boolean;
  sort?: CustomerSortKey;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

type Raw = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  created_at: number;
  last_login_at: number | null;
  orders_count: number;
  spent: number;
  status: CustomerStatus;
};

const SELECT = `SELECT u.id, u.email, p.name, p.phone, u.created_at, u.last_login_at, u.status,
  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders_count,
  (SELECT COALESCE(SUM(o.total_kopecks), 0) FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled', 'refunded', 'payment_failed')) AS spent
  FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id`;

const map = (r: Raw): CustomerRow => ({
  id: r.id,
  email: r.email,
  name: r.name,
  phone: r.phone,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
  ordersCount: Number(r.orders_count),
  spentKopecks: Number(r.spent),
  status: r.status,
});

const folded = new WeakSet<Db>();
function ensureLc(db: Db): void {
  if (folded.has(db)) return;
  db.function('rts_lc', { deterministic: true }, (v) => (typeof v === 'string' ? v.toLowerCase() : v));
  folded.add(db);
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

const SORT_SQL: Record<CustomerSortKey, string> = {
  registered: 'u.created_at',
  name: 'rts_lc(COALESCE(p.name, u.email))',
  orders: 'orders_count',
  spent: 'spent',
};

function where(f: CustomerFilter): { sql: string; args: Array<string | number> } {
  const parts: string[] = [];
  const args: Array<string | number> = [];
  const q = (f.q ?? '').trim();
  if (q) {
    const like = `%${escapeLike(q.toLowerCase())}%`;
    parts.push("(rts_lc(u.email) LIKE ? ESCAPE '\\' OR rts_lc(COALESCE(p.name, '')) LIKE ? ESCAPE '\\' OR COALESCE(p.phone, '') LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  if (f.status) {
    parts.push('u.status = ?');
    args.push(f.status);
  }
  if (f.from !== undefined) {
    parts.push('u.created_at >= ?');
    args.push(f.from);
  }
  if (f.to !== undefined) {
    parts.push('u.created_at < ?');
    args.push(f.to);
  }
  if (f.hasOrders === true) parts.push('EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)');
  if (f.hasOrders === false) parts.push('NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)');
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', args };
}

export const customersAdminRepo = {
  list(db: Db, f: CustomerFilter = {}): { rows: CustomerRow[]; total: number; page: number; pageSize: number } {
    ensureLc(db);
    const w = where(f);
    const pageSize = Math.min(Math.max(f.pageSize ?? 30, 1), 100);
    const page = Math.max(f.page ?? 1, 1);
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id ${w.sql}`).get(...w.args) as { n: number }).n);
    const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
    const order = `${SORT_SQL[f.sort ?? 'registered'] ?? 'u.created_at'} ${dir}, u.id ${dir}`;
    const rows = db.prepare(`${SELECT} ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...w.args, pageSize, (page - 1) * pageSize) as Raw[];
    return { rows: rows.map(map), total, page, pageSize };
  },

  /** Все под фильтр (для экспорта), не более limit. */
  listAll(db: Db, f: CustomerFilter, limit: number): CustomerRow[] {
    ensureLc(db);
    const w = where(f);
    const rows = db.prepare(`${SELECT} ${w.sql} ORDER BY u.id DESC LIMIT ?`).all(...w.args, limit) as Raw[];
    return rows.map(map);
  },

  findById(db: Db, id: number): CustomerRow | null {
    const r = db.prepare(`${SELECT} WHERE u.id = ?`).get(id) as Raw | undefined;
    return r ? map(r) : null;
  },

  orders(db: Db, userId: number): CustomerOrderRow[] {
    const rows = db.prepare('SELECT id, number, status, total_kopecks, is_paid, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(userId) as {
      id: number;
      number: string;
      status: string;
      total_kopecks: number;
      is_paid: number;
      created_at: number;
    }[];
    return rows.map((r) => ({ id: r.id, number: r.number, status: r.status, totalKopecks: r.total_kopecks, isPaid: r.is_paid === 1, createdAt: r.created_at }));
  },

  addresses(db: Db, userId: number): CustomerAddressRow[] {
    return (db.prepare('SELECT id, label, address FROM user_addresses WHERE user_id = ? ORDER BY id').all(userId) as CustomerAddressRow[]).map((a) => ({ id: a.id, label: a.label, address: a.address }));
  },

  consents(db: Db, userId: number): CustomerConsentRow[] {
    const rows = db.prepare('SELECT id, kind, source, granted_at FROM consents WHERE user_id = ? ORDER BY id DESC').all(userId) as Array<{ id: number; kind: string; source: string; granted_at: number }>;
    return rows.map((r) => ({ id: r.id, kind: r.kind, source: r.source, grantedAt: r.granted_at }));
  },

  setStatus(db: Db, id: number, status: CustomerStatus): void {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  },

  /** Блокировка закрывает и уже открытые сессии клиента. */
  deleteSessions(db: Db, userId: number): void {
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
  },

  insertNote(db: Db, userId: number, staffId: number, body: string, now: number): number {
    return Number(db.prepare('INSERT INTO customer_notes (user_id, staff_id, body, created_at) VALUES (?, ?, ?, ?)').run(userId, staffId, body, now).lastInsertRowid);
  },

  notes(db: Db, userId: number): CustomerNoteRow[] {
    const rows = db
      .prepare(
        `SELECT n.id, n.user_id, n.staff_id, COALESCE(s.name, s.email) AS author, n.body, n.created_at
         FROM customer_notes n LEFT JOIN staff s ON s.id = n.staff_id WHERE n.user_id = ? ORDER BY n.id DESC`,
      )
      .all(userId) as Array<{ id: number; user_id: number; staff_id: number | null; author: string | null; body: string; created_at: number }>;
    return rows.map((r) => ({ id: r.id, userId: r.user_id, staffId: r.staff_id, authorName: r.author, body: r.body, createdAt: r.created_at }));
  },
};
