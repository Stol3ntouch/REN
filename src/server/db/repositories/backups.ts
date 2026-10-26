import type { Db } from '../connection';

export type BackupKind = 'manual' | 'pre_restore';
export type BackupStatus = 'queued' | 'running' | 'ok' | 'error';

export type BackupRow = {
  id: number;
  kind: BackupKind;
  status: BackupStatus;
  progress: number;
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  filesCount: number | null;
  migrationVersion: number | null;
  error: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  verifiedAt: number | null;
  verifyOk: boolean | null;
  verifyMessage: string | null;
};

type Raw = {
  id: number;
  kind: BackupKind;
  status: BackupStatus;
  progress: number;
  file_name: string | null;
  size_bytes: number | null;
  sha256: string | null;
  files_count: number | null;
  migration_version: number | null;
  error: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  verified_at: number | null;
  verify_ok: number | null;
  verify_message: string | null;
};

const SELECT = `SELECT b.*, s.name AS created_by_name FROM backups b LEFT JOIN staff s ON s.id = b.created_by`;

const map = (r: Raw): BackupRow => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  progress: r.progress,
  fileName: r.file_name,
  sizeBytes: r.size_bytes,
  sha256: r.sha256,
  filesCount: r.files_count,
  migrationVersion: r.migration_version,
  error: r.error,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  verifiedAt: r.verified_at,
  verifyOk: r.verify_ok === null ? null : r.verify_ok === 1,
  verifyMessage: r.verify_message,
});

export const backupsRepo = {
  insert(db: Db, v: { kind: BackupKind; createdBy: number | null; now: number }): number {
    return Number(db.prepare("INSERT INTO backups (kind, status, created_by, created_at) VALUES (?, 'queued', ?, ?)").run(v.kind, v.createdBy, v.now).lastInsertRowid);
  },
  find(db: Db, id: number): BackupRow | null {
    const r = db.prepare(`${SELECT} WHERE b.id = ?`).get(id) as Raw | undefined;
    return r ? map(r) : null;
  },
  list(db: Db, limit: number, offset: number): { rows: BackupRow[]; total: number } {
    const total = Number((db.prepare('SELECT COUNT(*) AS n FROM backups').get() as { n: number }).n);
    const rows = (db.prepare(`${SELECT} ORDER BY b.id DESC LIMIT ? OFFSET ?`).all(limit, offset) as Raw[]).map(map);
    return { rows, total };
  },
  /** Есть ли задача в работе (queued/running) — одновременно копия делается одна. */
  active(db: Db): BackupRow | null {
    const r = db.prepare(`${SELECT} WHERE b.status IN ('queued', 'running') ORDER BY b.id LIMIT 1`).get() as Raw | undefined;
    return r ? map(r) : null;
  },
  markRunning(db: Db, id: number, now: number): void {
    db.prepare("UPDATE backups SET status = 'running', progress = 5, started_at = ? WHERE id = ?").run(now, id);
  },
  setProgress(db: Db, id: number, percent: number): void {
    db.prepare("UPDATE backups SET progress = ? WHERE id = ? AND status = 'running'").run(Math.max(0, Math.min(99, Math.round(percent))), id);
  },
  markOk(db: Db, id: number, v: { fileName: string; sizeBytes: number; sha256: string; filesCount: number; migrationVersion: number | null; now: number }): void {
    db.prepare("UPDATE backups SET status = 'ok', progress = 100, file_name = ?, size_bytes = ?, sha256 = ?, files_count = ?, migration_version = ?, finished_at = ?, error = NULL WHERE id = ?").run(
      v.fileName,
      v.sizeBytes,
      v.sha256,
      v.filesCount,
      v.migrationVersion,
      v.now,
      id,
    );
  },
  markError(db: Db, id: number, error: string, now: number): void {
    db.prepare("UPDATE backups SET status = 'error', error = ?, finished_at = ? WHERE id = ?").run(error.slice(0, 300), now, id);
  },
  /** Задачи, зависшие после падения процесса, закрываются ошибкой. */
  failStale(db: Db, olderThan: number, now: number): number {
    return Number(
      db.prepare("UPDATE backups SET status = 'error', error = 'Задача прервана: приложение было остановлено', finished_at = ? WHERE status IN ('queued', 'running') AND created_at < ?").run(now, olderThan).changes,
    );
  },
  setVerify(db: Db, id: number, v: { ok: boolean; message: string; now: number }): void {
    db.prepare('UPDATE backups SET verified_at = ?, verify_ok = ?, verify_message = ? WHERE id = ?').run(v.now, v.ok ? 1 : 0, v.message.slice(0, 300), id);
  },

  // ---- одноразовые ссылки на скачивание
  insertToken(db: Db, v: { tokenHash: string; backupId: number; staffId: number; expiresAt: number }): void {
    db.prepare('INSERT INTO backup_download_tokens (token_hash, backup_id, staff_id, expires_at) VALUES (?, ?, ?, ?)').run(v.tokenHash, v.backupId, v.staffId, v.expiresAt);
  },
  /** Погашает токен атомарно; вернёт копию, только если токен свой, живой и ещё не использован. */
  consumeToken(db: Db, v: { tokenHash: string; staffId: number; now: number }): number | null {
    const r = db
      .prepare('UPDATE backup_download_tokens SET used_at = ? WHERE token_hash = ? AND staff_id = ? AND used_at IS NULL AND expires_at >= ? RETURNING backup_id')
      .get(v.now, v.tokenHash, v.staffId, v.now) as { backup_id: number } | undefined;
    return r ? r.backup_id : null;
  },
  purgeTokens(db: Db, now: number): void {
    db.prepare('DELETE FROM backup_download_tokens WHERE expires_at < ? OR used_at IS NOT NULL').run(now - 3_600_000);
  },
};
