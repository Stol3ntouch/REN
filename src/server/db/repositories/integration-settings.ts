import type { Db } from '../connection';

export type IntegrationCheckRow = { key: string; status: 'ok' | 'error'; checkedAt: number; message: string | null; fingerprint: string; checkedBy: number | null };

type Raw = { key: string; status: 'ok' | 'error'; checked_at: number; message: string | null; fingerprint: string; checked_by: number | null };

/** Результаты проверок соединения. Секретов не хранит: отпечаток настроек строится без значений секретов. */
export const integrationChecksRepo = {
  get(db: Db, key: string): IntegrationCheckRow | null {
    const r = db.prepare('SELECT key, status, checked_at, message, fingerprint, checked_by FROM integration_checks WHERE key = ?').get(key) as Raw | undefined;
    return r ? { key: r.key, status: r.status, checkedAt: r.checked_at, message: r.message, fingerprint: r.fingerprint, checkedBy: r.checked_by } : null;
  },
  save(db: Db, v: { key: string; status: 'ok' | 'error'; message: string | null; fingerprint: string; now: number; staffId: number | null }): void {
    db.prepare(
      `INSERT INTO integration_checks (key, status, checked_at, message, fingerprint, checked_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at, message = excluded.message, fingerprint = excluded.fingerprint, checked_by = excluded.checked_by`,
    ).run(v.key, v.status, v.now, v.message === null ? null : v.message.slice(0, 300), v.fingerprint, v.staffId);
  },
};
