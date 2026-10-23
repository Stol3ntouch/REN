import type { Db } from '../connection';

/** Покупатель для админки: контакты и итоги по заказам. Хеш пароля и сессии сюда не попадают. */
export type CustomerRow = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  createdAt: number;
  lastLoginAt: number | null;
  ordersCount: number;
};

export type CustomerOrderRow = { id: number; number: string; status: string; totalKopecks: number; isPaid: boolean; createdAt: number };

type Raw = { id: number; email: string; name: string | null; phone: string | null; created_at: number; last_login_at: number | null; orders_count: number };

const SELECT = `SELECT u.id, u.email, p.name, p.phone, u.created_at, u.last_login_at,
  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders_count
  FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id`;

const map = (r: Raw): CustomerRow => ({
  id: r.id,
  email: r.email,
  name: r.name,
  phone: r.phone,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
  ordersCount: Number(r.orders_count),
});

const folded = new WeakSet<Db>();
function ensureLc(db: Db): void {
  if (folded.has(db)) return;
  db.function('rts_lc', { deterministic: true }, (v) => (typeof v === 'string' ? v.toLowerCase() : v));
  folded.add(db);
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export const customersAdminRepo = {
  list(db: Db, f: { q?: string; page?: number; pageSize?: number } = {}): { rows: CustomerRow[]; total: number; page: number; pageSize: number } {
    ensureLc(db);
    const args: string[] = [];
    let where = '';
    if (f.q) {
      const like = `%${escapeLike(f.q.toLowerCase())}%`;
      where = "WHERE rts_lc(u.email) LIKE ? ESCAPE '\\' OR rts_lc(COALESCE(p.name, '')) LIKE ? ESCAPE '\\' OR COALESCE(p.phone, '') LIKE ? ESCAPE '\\'";
      args.push(like, like, like);
    }
    const pageSize = Math.min(Math.max(f.pageSize ?? 30, 1), 100);
    const page = Math.max(f.page ?? 1, 1);
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id ${where}`).get(...args) as { n: number }).n);
    const rows = db.prepare(`${SELECT} ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as Raw[];
    return { rows: rows.map(map), total, page, pageSize };
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
};
