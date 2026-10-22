import type { Db } from '../connection';

export type ConsentRow = {
  id: number;
  kind: string;
  source: string;
  userId: number | null;
  guestId: string | null;
  subject: string | null;
  textVersion: string | null;
  grantedAt: number;
};

type Raw = {
  id: number;
  kind: string;
  source: string;
  user_id: number | null;
  guest_id: string | null;
  subject: string | null;
  text_version: string | null;
  granted_at: number;
};

export const consentsRepo = {
  insert(
    db: Db,
    v: { kind: string; source: string; userId?: number | null; guestId?: string | null; subject?: string | null; textVersion?: string | null; now: number },
  ): number {
    const r = db
      .prepare('INSERT INTO consents (kind, source, user_id, guest_id, subject, text_version, granted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(v.kind, v.source, v.userId ?? null, v.guestId ?? null, v.subject ?? null, v.textVersion ?? null, v.now);
    return Number(r.lastInsertRowid);
  },
  listAll(db: Db, f: { userId?: number } = {}): ConsentRow[] {
    const rows = (
      f.userId === undefined
        ? db.prepare('SELECT * FROM consents ORDER BY id').all()
        : db.prepare('SELECT * FROM consents WHERE user_id = ? ORDER BY id').all(f.userId)
    ) as Raw[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      source: r.source,
      userId: r.user_id,
      guestId: r.guest_id,
      subject: r.subject,
      textVersion: r.text_version,
      grantedAt: r.granted_at,
    }));
  },
};
