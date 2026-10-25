import type { Db } from '../connection';

export type RequestKind = 'repair' | 'callback' | 'contact' | 'question';
/** Общий набор: обращения — new/in_work/waiting/closed; ремонт — new/diagnostics/…/completed/cancelled (см. domain/requests/workflow.ts). */
export type RequestStatus =
  | 'new'
  | 'in_work'
  | 'waiting'
  | 'closed'
  | 'diagnostics'
  | 'awaiting_approval'
  | 'in_repair'
  | 'awaiting_parts'
  | 'ready'
  | 'completed'
  | 'cancelled';
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
  subject: string | null;
  assignedStaffId: number | null;
  repairBrand: string | null;
  repairModel: string | null;
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
  subject: string | null;
  assigned_staff_id: number | null;
  repair_brand: string | null;
  repair_model: string | null;
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
  subject: r.subject,
  assignedStaffId: r.assigned_staff_id,
  repairBrand: r.repair_brand,
  repairModel: r.repair_model,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const NUMBER_PREFIX: Record<RequestKind, string> = { repair: 'REM', callback: 'ZV', contact: 'MSG', question: 'VOP' };

export type RequestSearch = {
  kinds?: readonly RequestKind[];
  statuses?: readonly RequestStatus[];
  q?: string;
  assignedStaffId?: number | 'none';
  from?: number;
  to?: number;
  sort?: 'created' | 'number' | 'status' | 'name';
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export type RequestEventRow = {
  id: number;
  requestId: number;
  at: number;
  kind: 'created' | 'status' | 'assigned' | 'comment' | 'edit' | 'photo';
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus | null;
  actorType: 'customer' | 'staff' | 'system';
  actorId: string | null;
  note: string | null;
};
export type RequestCommentRow = { id: number; requestId: number; staffId: number | null; authorName: string | null; body: string; createdAt: number };
export type RequestPhotoRow = { id: number; requestId: number; path: string; width: number; height: number; position: number; createdAt: number };

const SORT_SQL = { created: 'r.created_at', number: 'r.id', status: 'r.status', name: 'r.name' } as const;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

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
      subject?: string | null;
      repairBrand?: string | null;
      repairModel?: string | null;
      now: number;
    },
  ): { id: number; number: string } {
    const r = db
      .prepare(
        `INSERT INTO requests (kind, name, phone, email, preferred_contact, equipment_type, message, product_id, user_id, guest_id, subject, repair_brand, repair_model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        v.subject ?? null,
        v.repairBrand ?? null,
        v.repairModel ?? null,
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
  /** Поиск с фильтрами, сортировкой и страницами (обращения и ремонт). Сортировка — только из белого списка. */
  search(db: Db, f: RequestSearch): { rows: RequestRow[]; total: number } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.kinds?.length) {
      where.push(`r.kind IN (${f.kinds.map(() => '?').join(', ')})`);
      args.push(...f.kinds);
    }
    if (f.statuses?.length) {
      where.push(`r.status IN (${f.statuses.map(() => '?').join(', ')})`);
      args.push(...f.statuses);
    }
    const q = (f.q ?? '').trim().toLowerCase();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const digits = q.replace(/\D/g, '');
      const parts = [
        String.raw`lower(r.number) LIKE ? ESCAPE '\'`,
        String.raw`lower(r.name) LIKE ? ESCAPE '\'`,
        String.raw`lower(COALESCE(r.email, '')) LIKE ? ESCAPE '\'`,
        String.raw`lower(COALESCE(r.message, '')) LIKE ? ESCAPE '\'`,
        String.raw`lower(COALESCE(r.subject, '')) LIKE ? ESCAPE '\'`,
        String.raw`lower(COALESCE(r.repair_model, '')) LIKE ? ESCAPE '\'`,
      ];
      args.push(like, like, like, like, like, like);
      if (digits.length >= 3) {
        parts.push(`REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(r.phone, ''), ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?`);
        args.push(`%${digits}%`);
      }
      where.push(`(${parts.join(' OR ')})`);
    }
    if (f.assignedStaffId === 'none') where.push('r.assigned_staff_id IS NULL');
    else if (typeof f.assignedStaffId === 'number') {
      where.push('r.assigned_staff_id = ?');
      args.push(f.assignedStaffId);
    }
    if (f.from !== undefined) {
      where.push('r.created_at >= ?');
      args.push(f.from);
    }
    if (f.to !== undefined) {
      where.push('r.created_at < ?');
      args.push(f.to);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((db.prepare(`SELECT COUNT(*) AS c FROM requests r ${w}`).get(...args) as { c: number }).c);
    const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
    const col = SORT_SQL[f.sort ?? 'created'] ?? 'r.created_at';
    const rows = db
      .prepare(`${SELECT} ${w} ORDER BY ${col} ${dir}, r.id ${dir} LIMIT ? OFFSET ?`)
      .all(...args, Math.min(Math.max(f.limit ?? 20, 1), 200), Math.max(f.offset ?? 0, 0)) as Raw[];
    return { rows: rows.map(map), total };
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
  setAssigned(db: Db, id: number, staffId: number | null, now: number): void {
    db.prepare('UPDATE requests SET assigned_staff_id = ?, updated_at = ? WHERE id = ?').run(staffId, now, id);
  },
  /** Правка полей заявки на ремонт из админки. */
  updateRepairFields(db: Db, id: number, v: { equipmentType: string | null; repairBrand: string | null; repairModel: string | null; message: string | null; phone: string | null; email: string | null }, now: number): void {
    db.prepare('UPDATE requests SET equipment_type = ?, repair_brand = ?, repair_model = ?, message = ?, phone = ?, email = ?, updated_at = ? WHERE id = ?').run(
      v.equipmentType,
      v.repairBrand,
      v.repairModel,
      v.message,
      v.phone,
      v.email,
      now,
      id,
    );
  },

  // --- история и комментарии ---
  insertEvent(
    db: Db,
    e: { requestId: number; at: number; kind: RequestEventRow['kind']; fromStatus?: RequestStatus | null; toStatus?: RequestStatus | null; actorType: RequestEventRow['actorType']; actorId?: string | null; note?: string | null },
  ): void {
    db.prepare('INSERT INTO request_events (request_id, at, kind, from_status, to_status, actor_type, actor_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      e.requestId,
      e.at,
      e.kind,
      e.fromStatus ?? null,
      e.toStatus ?? null,
      e.actorType,
      e.actorId ?? null,
      e.note ?? null,
    );
  },
  listEvents(db: Db, requestId: number): RequestEventRow[] {
    const rows = db.prepare('SELECT * FROM request_events WHERE request_id = ? ORDER BY id').all(requestId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      requestId: r.request_id as number,
      at: r.at as number,
      kind: r.kind as RequestEventRow['kind'],
      fromStatus: (r.from_status as RequestStatus | null) ?? null,
      toStatus: (r.to_status as RequestStatus | null) ?? null,
      actorType: r.actor_type as RequestEventRow['actorType'],
      actorId: (r.actor_id as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    }));
  },
  insertComment(db: Db, requestId: number, staffId: number, body: string, now: number): number {
    return Number(db.prepare('INSERT INTO request_comments (request_id, staff_id, body, created_at) VALUES (?, ?, ?, ?)').run(requestId, staffId, body, now).lastInsertRowid);
  },
  listComments(db: Db, requestId: number): RequestCommentRow[] {
    const rows = db
      .prepare(
        `SELECT c.id, c.request_id, c.staff_id, COALESCE(s.name, s.email) AS author, c.body, c.created_at
         FROM request_comments c LEFT JOIN staff s ON s.id = c.staff_id WHERE c.request_id = ? ORDER BY c.id`,
      )
      .all(requestId) as Array<{ id: number; request_id: number; staff_id: number | null; author: string | null; body: string; created_at: number }>;
    return rows.map((r) => ({ id: r.id, requestId: r.request_id, staffId: r.staff_id, authorName: r.author, body: r.body, createdAt: r.created_at }));
  },

  // --- фото ремонта ---
  listPhotos(db: Db, requestId: number): RequestPhotoRow[] {
    const rows = db.prepare('SELECT * FROM request_photos WHERE request_id = ? ORDER BY position, id').all(requestId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      requestId: r.request_id as number,
      path: r.path as string,
      width: r.width as number,
      height: r.height as number,
      position: r.position as number,
      createdAt: r.created_at as number,
    }));
  },
  countPhotos(db: Db, requestId: number): number {
    return Number((db.prepare('SELECT COUNT(*) AS c FROM request_photos WHERE request_id = ?').get(requestId) as { c: number }).c);
  },
  insertPhoto(db: Db, v: { requestId: number; path: string; width: number; height: number; position: number; now: number }): number {
    return Number(
      db.prepare('INSERT INTO request_photos (request_id, path, width, height, position, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(v.requestId, v.path, v.width, v.height, v.position, v.now).lastInsertRowid,
    );
  },
  findPhoto(db: Db, photoId: number): RequestPhotoRow | null {
    const r = db.prepare('SELECT * FROM request_photos WHERE id = ?').get(photoId) as Record<string, unknown> | undefined;
    return r
      ? { id: r.id as number, requestId: r.request_id as number, path: r.path as string, width: r.width as number, height: r.height as number, position: r.position as number, createdAt: r.created_at as number }
      : null;
  },
  deletePhoto(db: Db, photoId: number): void {
    db.prepare('DELETE FROM request_photos WHERE id = ?').run(photoId);
  },
};
