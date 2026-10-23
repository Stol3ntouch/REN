import type { Db } from '../connection';

export type ProfileRow = { userId: number; name: string | null; phone: string | null; updatedAt: number };
export type AddressRow = { id: number; userId: number; label: string | null; address: string; createdAt: number };

type RawProfile = { user_id: number; name: string | null; phone: string | null; updated_at: number };
type RawAddress = { id: number; user_id: number; label: string | null; address: string; created_at: number };
const mapAddress = (r: RawAddress): AddressRow => ({ id: r.id, userId: r.user_id, label: r.label, address: r.address, createdAt: r.created_at });

/** Профиль покупателя (имя, телефон) — отдельная таблица, чтобы не трогать users из T03. */
export const profilesRepo = {
  find(db: Db, userId: number): ProfileRow | null {
    const r = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as RawProfile | undefined;
    return r ? { userId: r.user_id, name: r.name, phone: r.phone, updatedAt: r.updated_at } : null;
  },
  upsert(db: Db, v: { userId: number; name: string | null; phone: string | null; now: number }): void {
    db.prepare(
      `INSERT INTO user_profiles (user_id, name, phone, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, phone = excluded.phone, updated_at = excluded.updated_at`,
    ).run(v.userId, v.name, v.phone, v.now);
  },
};

export const addressesRepo = {
  listByUser(db: Db, userId: number): AddressRow[] {
    return (db.prepare('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY id').all(userId) as RawAddress[]).map(mapAddress);
  },
  countByUser(db: Db, userId: number): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM user_addresses WHERE user_id = ?').get(userId) as { n: number }).n;
  },
  insert(db: Db, v: { userId: number; label: string | null; address: string; now: number }): number {
    const r = db.prepare('INSERT INTO user_addresses (user_id, label, address, created_at) VALUES (?, ?, ?, ?)').run(v.userId, v.label, v.address, v.now);
    return Number(r.lastInsertRowid);
  },
  /** Удаляет только адрес этого пользователя; false — такого адреса у него нет. */
  delete(db: Db, userId: number, id: number): boolean {
    return Number(db.prepare('DELETE FROM user_addresses WHERE id = ? AND user_id = ?').run(id, userId).changes) > 0;
  },
};
