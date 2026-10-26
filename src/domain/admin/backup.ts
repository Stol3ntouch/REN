import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createBackup, sha256File } from '../../../scripts/backup';
import { applyPendingRestore, cancelPendingRestore, readPendingRestore, verifyBackupArchive, writePendingRestore, type PendingRestore } from '../../../scripts/restore';
import { verifyPassword } from '@/domain/customers/password';
import { getConfig } from '@/server/config';
import { getDb, type Db } from '@/server/db/connection';
import { backupsRepo, type BackupRow } from '@/server/db/repositories/backups';
import { staffRepo } from '@/server/db/repositories/staff';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';
import { enforceRateLimit } from '@/server/http/rate-limit';
import { audit } from './audit';
import { requirePermission, type StaffSession } from './permissions';

/**
 * Резервные копии из интерфейса (C12, ADR-016).
 *
 * Это копия БАЗЫ ДАННЫХ и загруженных файлов (SQLite VACUUM INTO + uploads + onec-outbox, SHA-256 в манифесте), а не экспорт товаров:
 * экспорт каталога не содержит заказов, клиентов, пользователей и настроек и восстановить из него магазин нельзя.
 *
 * Создание — задача со статусом queued → running → ok | error и прогрессом; одновременно одна.
 * Скачивание — только по праву backup.run и одноразовой ссылке на 5 минут; пути на диске наружу не отдаются.
 * Восстановление — двухшаговое: слово «ВОССТАНОВИТЬ» и пароль сотрудника, права backup.run + settings.write; перед ним создаётся копия «до восстановления».
 * Заменить файл БД у работающего процесса безопасно нельзя, поэтому запрос ставит метку, а замену выполняет СЛЕДУЮЩИЙ запуск приложения
 * (или `npm run restore -- --pending`), прежнее состояние сохраняется в data/pre-restore-*.
 */

export type BackupPaths = { databasePath: string; dataDir: string };
type Opts = Partial<BackupPaths> & { db?: Db; now?: number };

export const RESTORE_WORD = 'ВОССТАНОВИТЬ';
export const DOWNLOAD_TTL_MS = 5 * 60_000;
const STALE_JOB_MS = 30 * 60_000;
const FILE_RE = /^rts-backup-[0-9-]+\.tar\.gz$/;

function paths(opts: Opts): BackupPaths {
  if (opts.databasePath && opts.dataDir) return { databasePath: opts.databasePath, dataDir: opts.dataDir };
  const cfg = getConfig();
  return { databasePath: opts.databasePath ?? cfg.databasePath, dataDir: opts.dataDir ?? cfg.dataDir };
}

/** Текст ошибки без путей на диске. */
function scrub(e: unknown, p: BackupPaths): string {
  let t = e instanceof Error ? e.message : 'внутренняя ошибка';
  for (const secret of [resolve(p.databasePath), resolve(p.dataDir), process.cwd()]) t = t.split(secret).join('…');
  return t.replace(/\s+/g, ' ').slice(0, 300);
}

const backupsDir = (p: BackupPaths): string => join(resolve(p.dataDir), 'backups');

function fileOf(row: BackupRow, p: BackupPaths): string | null {
  if (row.status !== 'ok' || !row.fileName || !FILE_RE.test(row.fileName)) return null;
  const f = join(backupsDir(p), row.fileName);
  return existsSync(f) ? f : null;
}

async function runJob(db: Db, id: number, p: BackupPaths, actor: number | null, now?: number): Promise<void> {
  const t = () => now ?? Date.now();
  backupsRepo.markRunning(db, id, t());
  try {
    const r = await createBackup({ databasePath: p.databasePath, dataDir: p.dataDir, ...(now ? { now } : {}), onProgress: (pc) => backupsRepo.setProgress(db, id, pc) });
    const sha256 = await sha256File(r.file);
    backupsRepo.markOk(db, id, { fileName: basename(r.file), sizeBytes: statSync(r.file).size, sha256, filesCount: r.files, migrationVersion: r.migrationVersion, now: t() });
    audit.record({ actorId: actor, actorType: actor === null ? 'system' : 'staff', action: 'backup.finish', entity: 'backup', entityId: id, after: { bytes: r.bytes, files: r.files } }, { db, now: t() });
  } catch (e) {
    backupsRepo.markError(db, id, scrub(e, p), t());
    audit.record({ actorId: actor, actorType: actor === null ? 'system' : 'staff', action: 'backup.finish', entity: 'backup', entityId: id, result: 'error' }, { db, now: t() });
  }
}

export type BackupView = {
  rows: BackupRow[];
  total: number;
  pending: PendingRestore | null;
  running: BackupRow | null;
};

export const backupAdmin = {
  list(session: StaffSession | null, f: { limit: number; offset: number }, opts: Opts = {}): BackupView {
    requirePermission(session, 'backup.run');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    backupsRepo.failStale(db, now - STALE_JOB_MS, now);
    const { rows, total } = backupsRepo.list(db, f.limit, f.offset);
    return { rows, total, pending: readPendingRestore(paths(opts).dataDir), running: backupsRepo.active(db) };
  },

  /** Ставит задачу и запускает её в фоне; `done` нужен тестам — интерфейс его не ждёт. */
  start(session: StaffSession | null, opts: Opts = {}): { id: number; done: Promise<void> } {
    requirePermission(session, 'backup.run');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const p = paths(opts);
    backupsRepo.failStale(db, now - STALE_JOB_MS, now);
    if (backupsRepo.active(db)) throw new ConflictError('Копия уже создаётся: дождитесь завершения');
    const id = backupsRepo.insert(db, { kind: 'manual', createdBy: session.staffId, now });
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'backup.create', entity: 'backup', entityId: id }, { db, now });
    const done = new Promise<void>((resolveJob) => {
      setImmediate(() => void runJob(db, id, p, session.staffId, opts.now).then(resolveJob, resolveJob));
    });
    return { id, done };
  },

  /** Проверка: контрольная сумма файла, манифест, SHA-256 каждого файла внутри, integrity_check базы. */
  async verify(session: StaffSession | null, id: number, opts: Opts = {}): Promise<{ ok: boolean; message: string }> {
    requirePermission(session, 'backup.run');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const p = paths(opts);
    const row = backupsRepo.find(db, id);
    if (!row) throw new NotFoundError('Копия не найдена');
    if (row.status !== 'ok') throw new ConflictError('Проверять можно только готовую копию');
    const file = fileOf(row, p);
    let result: { ok: boolean; message: string };
    if (!file) result = { ok: false, message: 'Файл копии не найден на диске' };
    else if ((await sha256File(file)) !== row.sha256) result = { ok: false, message: 'Контрольная сумма файла не совпала с записанной при создании: файл изменён или повреждён' };
    else {
      try {
        const r = await verifyBackupArchive(file, backupsDir(p));
        result = { ok: true, message: `Копия цела: файлов ${r.files}, версия миграций ${r.migrationVersion ?? 'нет'}; контрольные суммы и целостность базы сошлись` };
      } catch (e) {
        result = { ok: false, message: scrub(e, p) };
      }
    }
    backupsRepo.setVerify(db, id, { ...result, now });
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'backup.verify', entity: 'backup', entityId: id, result: result.ok ? 'ok' : 'error' }, { db, now });
    return result;
  },

  /** Одноразовая ссылка (5 минут). Путь на диске не раскрывается. */
  downloadLink(session: StaffSession | null, id: number, opts: Opts = {}): { path: string; expiresAt: number } {
    requirePermission(session, 'backup.run');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const row = backupsRepo.find(db, id);
    if (!row) throw new NotFoundError('Копия не найдена');
    if (!fileOf(row, paths(opts))) throw new ConflictError('Файл копии недоступен');
    backupsRepo.purgeTokens(db, now);
    const token = randomBytes(32).toString('hex');
    const expiresAt = now + DOWNLOAD_TTL_MS;
    backupsRepo.insertToken(db, { tokenHash: createHash('sha256').update(token).digest('hex'), backupId: id, staffId: session.staffId, expiresAt });
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'backup.download_link', entity: 'backup', entityId: id }, { db, now });
    return { path: `/admin/api/backup/download?token=${token}`, expiresAt };
  },

  /** Погашает ссылку и отдаёт файл для потоковой выдачи. Чужая, просроченная или использованная ссылка — 404. */
  consumeDownload(session: StaffSession | null, token: string, opts: Opts = {}): { file: string; downloadName: string; size: number } {
    requirePermission(session, 'backup.run');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    if (!/^[0-9a-f]{64}$/.test(token)) throw new NotFoundError('Ссылка недействительна');
    const id = backupsRepo.consumeToken(db, { tokenHash: createHash('sha256').update(token).digest('hex'), staffId: session.staffId, now });
    if (id === null) throw new NotFoundError('Ссылка недействительна или уже использована');
    const row = backupsRepo.find(db, id);
    const file = row ? fileOf(row, paths(opts)) : null;
    if (!row || !file) throw new NotFoundError('Файл копии недоступен');
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'backup.download', entity: 'backup', entityId: id }, { db, now });
    return { file, downloadName: row.fileName as string, size: statSync(file).size };
  },

  /**
   * Запрос восстановления. Требует backup.run и settings.write, слово «ВОССТАНОВИТЬ» и пароль текущего сотрудника.
   * Перед этим проверяется выбранная копия и создаётся копия «до восстановления»; без неё запрос не принимается.
   */
  async requestRestore(session: StaffSession | null, input: { id: number; confirmWord: string; password: string }, opts: Opts = {}): Promise<{ preRestoreId: number }> {
    requirePermission(session, 'backup.run');
    requirePermission(session, 'settings.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const p = paths(opts);
    enforceRateLimit(`backup-restore:${session.staffId}`, 5, 900, { db, now });
    if ((input.confirmWord ?? '').trim() !== RESTORE_WORD) throw new ValidationError(`Введите слово ${RESTORE_WORD} заглавными буквами`, { confirmWord: [`Введите слово ${RESTORE_WORD}`] });
    const staff = staffRepo.findById(db, session.staffId);
    if (!staff || !staff.active || !(await verifyPassword(input.password ?? '', staff.passwordHash))) {
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'backup.restore_denied', entity: 'backup', entityId: input.id, result: 'denied' }, { db, now });
      throw new ValidationError('Пароль указан неверно', { password: ['Пароль указан неверно'] });
    }
    const row = backupsRepo.find(db, input.id);
    if (!row) throw new NotFoundError('Копия не найдена');
    const file = fileOf(row, p);
    if (!file) throw new ConflictError('Файл копии недоступен: восстановление невозможно');
    if (readPendingRestore(p.dataDir)) throw new ConflictError('Восстановление уже запрошено: отмените его или перезапустите приложение');
    if (backupsRepo.active(db)) throw new ConflictError('Сейчас создаётся копия: дождитесь завершения');
    try {
      await verifyBackupArchive(file, backupsDir(p));
    } catch (e) {
      throw new ConflictError(`Выбранная копия не прошла проверку, восстановление отклонено: ${scrub(e, p)}`);
    }
    const preRestoreId = backupsRepo.insert(db, { kind: 'pre_restore', createdBy: session.staffId, now });
    await runJob(db, preRestoreId, p, session.staffId, opts.now);
    const pre = backupsRepo.find(db, preRestoreId);
    if (pre?.status !== 'ok') throw new ConflictError(`Копию «до восстановления» создать не удалось (${pre?.error ?? 'ошибка'}): восстановление отклонено, данные не тронуты`);
    writePendingRestore(p.dataDir, { backupFile: row.fileName as string, backupId: row.id, requestedBy: session.staffId, requestedAt: now });
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'backup.restore_request', entity: 'backup', entityId: row.id, after: { preRestoreId } }, { db, now });
    return { preRestoreId };
  },

  cancelRestore(session: StaffSession | null, opts: Opts = {}): boolean {
    requirePermission(session, 'backup.run');
    requirePermission(session, 'settings.write');
    const db = opts.db ?? getDb();
    const cancelled = cancelPendingRestore(paths(opts).dataDir);
    if (cancelled) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'backup.restore_cancel', entity: 'backup' }, { db, now: opts.now });
    return cancelled;
  },
};

/** Старт приложения: применить отложенное восстановление до открытия БД. Возвращает короткое описание для лога (без путей и секретов). */
export async function applyPendingRestoreAtStart(): Promise<string | null> {
  const cfg = getConfig();
  const r = await applyPendingRestore({ dataDir: cfg.dataDir, databasePath: cfg.databasePath });
  if (!r) return null;
  if (!r.ok) return `Восстановление из копии не выполнено: ${r.error}. Данные не изменены.`;
  try {
    audit.record({ actorId: r.request.requestedBy, actorType: 'staff', action: 'backup.restore_apply', entity: 'backup', entityId: r.request.backupId, after: { files: r.result.files } });
  } catch {
    /* журнал в восстановленной базе мог быть старее схемы — восстановление от этого не страдает */
  }
  return `Данные восстановлены из резервной копии (файлов: ${r.result.files}).`;
}
