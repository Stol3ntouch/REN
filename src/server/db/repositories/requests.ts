import type { Db } from '../connection';

export type RequestKind = 'repair' | 'callback' | 'contact' | 'question';
export type RequestStatus = 'new' | 'in_work' | 'done' | 'cancelled';
export type PreferredContact = 'phone' | 'email' | 'messenger';

export type RequestRow = {
  id: number;
  number: string;
  kind: RequestKind;
  status: RequestStatus;
  name: string;
  phone: string | null;
  email: string | null;
  preferredContact: PreferredContact | null;
  equipmentType: string | null;
  message: string | null;
  productId: number | null;
  productName: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

type Raw = {
  id: number;
  number: string;
  kind: RequestKind;
  status: RequestStatus;
  name: string;
  phone: string | null;
  email: string | null;
  preferred_contact: PreferredContact | null;
  equipment_type: string | null;
  message: string | null;
  product_id: number | null;
  product_name: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
};

const SELECT = `SELECT r.*, p.name AS product_name FROM requests r LEFT JOIN products p ON p.id = r.product_id`;

const map = (r: Raw): RequestRow => ({
  id: r.id,
  number: r.number,
  kind: r.kind,
  status: r.status,
  name: r.name,
  phone: r.phone,
  email: r.email,
  preferredContact: r.preferred_contact,
  equipmentType: r.equipment_type,
  message: r.message,
  productId: r.product_id,
  productName: r.product_name,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const NUMBER_PREFIX: Record<RequestKind, string> = { repair: 'REM', callback: 'ZV', contact: 'MSG', question: 'VOP' };

export const requestsRepo = {
  /** Вставляет заявку и сразу присваивает номер вида REM-000012 (вызывать внутри транзакции). */
  insert(
    db: Db,
    v: {
      kind: RequestKind;
      name: string;
      phone?: string | null;
      email?: string | null;
      preferredContact?: PreferredContact | null;
      equipmentType?: string | null;
      message?: string | null;
      productId?: number | null;
      userId?: number | null;
      guestId?: string | null;
      now: number;
    },
  ): { id: number; number: string } {
    const r = db
      .prepare(
        `INSERT INTO requests (kind, name, phone, email, preferred_contact, equipment_type, message, product_id, user_id, guest_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        v.kind,
        v.name,
        v.phone ?? null,
        v.email ?? null,
        v.preferredContact ?? null,
        v.equipmentType ?? null,
        v.message ?? null,
        v.productId ?? null,
        v.userId ?? null,
        v.guestId ?? null,
        v.now,
        v.now,
      );
    const id = Number(r.lastInsertRowid);
    const number = `${NUMBER_PREFIX[v.kind]}-${String(id).padStart(6, '0')}`;
    db.prepare('UPDATE requests SET number = ? WHERE id = ?').run(number, id);
    return { id, number };
  },
  setConsent(db: Db, id: number, consentId: number): void {
    db.prepare('UPDATE requests SET consent_id = ? WHERE id = ?').run(consentId, id);
  },
  findById(db: Db, id: number): RequestRow | null {
    const r = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Raw | undefined;
    return r ? map(r) : null;
  },
  list(db: Db, f: { kind?: RequestKind; status?: RequestStatus; limit?: number; offset?: number } = {}): RequestRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.kind) {
      where.push('r.kind = ?');
      args.push(f.kind);
    }
    if (f.status) {
      where.push('r.status = ?');
      args.push(f.status);
    }
    const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`;
    return (db.prepare(sql).all(...args, f.limit ?? 100, f.offset ?? 0) as Raw[]).map(map);
  },
  update(db: Db, id: number, v: { status?: RequestStatus; note?: string | null; handledBy: number | null; now: number }): void {
    const sets = ['updated_at = ?', 'handled_by = ?'];
    const args: (string | number | null)[] = [v.now, v.handledBy];
    if (v.status !== undefined) {
      sets.push('status = ?');
      args.push(v.status);
    }
    if (v.note !== undefined) {
      sets.push('note = ?');
      args.push(v.note);
    }
    db.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  },
};
