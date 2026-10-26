import { existsSync, mkdtempSync, readFileSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listArchive } from '../../scripts/backup';
import { applyPendingRestore, readPendingRestore } from '../../scripts/restore';
import { RESTORE_WORD, backupAdmin } from '@/domain/admin/backup';
import type { StaffSession } from '@/domain/admin/permissions';
import { hashPassword } from '@/domain/customers/password';
import { openDatabase, type Db } from '@/server/db/connection';
import { runMigrations } from '@/server/db/migrate';
import { backupsRepo } from '@/server/db/repositories/backups';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { admin, manager } from '../admin/helpers';

const PASSWORD = 'Correct-Horse-1234';
const dirs: string[] = [];
const dbs: Db[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) {
    try {
      d.close();
    } catch {
      /* уже закрыта */
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rts-bk-'));
  dirs.push(dir);
  const databasePath = join(dir, 'rts.sqlite');
  const db = openDatabase(databasePath);
  dbs.push(db);
  runMigrations(db);
  const hash = await hashPassword(PASSWORD);
  db.prepare("INSERT INTO staff (id, email, name, role_id, password_hash, created_at) VALUES (1, 'boss@shop.test', 'Админ', (SELECT id FROM roles WHERE code = 'admin'), ?, 1)").run(hash);
  db.prepare("INSERT INTO staff (id, email, name, role_id, password_hash, created_at) VALUES (2, 'mgr@shop.test', 'Менеджер', (SELECT id FROM roles WHERE code = 'manager'), ?, 1)").run(hash);
  const o = { db, databasePath, dataDir: dir, now: Date.UTC(2026, 9, 25, 10, 0, 0) };
  return { dir, db, databasePath, o };
}

async function makeBackup(o: Awaited<ReturnType<typeof setup>>['o'], now = o.now) {
  const { id, done } = backupAdmin.start(admin, { ...o, now });
  await done;
  return { id, row: backupsRepo.find(o.db, id)! };
}

describe('создание копии: задача со статусом', () => {
  it('queued → ok: файл, размер, sha256 и версия миграций записаны; в архиве нет .env', async () => {
    const { dir, o } = await setup();
    const { id, done } = backupAdmin.start(admin, o);
    expect(backupsRepo.find(o.db, id)!.status).toBe('queued');
    await done;
    const row = backupsRepo.find(o.db, id)!;
    expect(row).toMatchObject({ status: 'ok', progress: 100, kind: 'manual', createdBy: 1, createdByName: 'Админ' });
    expect(row.fileName).toMatch(/^rts-backup-\d{8}-\d{6}\.tar\.gz$/);
    expect(row.sizeBytes).toBeGreaterThan(0);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.migrationVersion).toBeGreaterThanOrEqual(1590);
    const names = (await listArchive(join(dir, 'backups', row.fileName!))).map((e) => e.name);
    expect(names).toContain('rts.sqlite');
    expect(names).toContain('manifest.json');
    expect(names.some((n) => /\.env|secret/i.test(n))).toBe(false);
  });

  it('вторая копия во время первой отклоняется', async () => {
    const { o } = await setup();
    const first = backupAdmin.start(admin, o);
    expect(() => backupAdmin.start(admin, o)).toThrow(ConflictError);
    await first.done;
    await expect(backupAdmin.start(admin, { ...o, now: o.now + 5000 }).done).resolves.toBeUndefined();
  });

  it('сбой создания: статус error, причина без путей на диске', async () => {
    const { dir, o } = await setup();
    const { id, done } = backupAdmin.start(admin, { ...o, databasePath: join(dir, 'нет-такой.sqlite') });
    await done;
    const row = backupsRepo.find(o.db, id)!;
    expect(row.status).toBe('error');
    expect(row.error).toBeTruthy();
    expect(row.error).not.toContain(dir);
  });

  it('зависшая задача (процесс упал) закрывается ошибкой при следующем просмотре', async () => {
    const { o } = await setup();
    const id = backupsRepo.insert(o.db, { kind: 'manual', createdBy: 1, now: o.now - 3_600_000 });
    backupsRepo.markRunning(o.db, id, o.now - 3_600_000);
    const view = backupAdmin.list(admin, { limit: 10, offset: 0 }, o);
    expect(view.running).toBeNull();
    expect(backupsRepo.find(o.db, id)!.status).toBe('error');
  });
});

describe('проверка копии', () => {
  it('целая копия проходит, испорченный файл — нет', async () => {
    const { dir, o } = await setup();
    const { id, row } = await makeBackup(o);
    expect(await backupAdmin.verify(admin, id, o)).toMatchObject({ ok: true });
    expect(backupsRepo.find(o.db, id)).toMatchObject({ verifyOk: true });
    appendFileSync(join(dir, 'backups', row.fileName!), Buffer.from('мусор'));
    const bad = await backupAdmin.verify(admin, id, o);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('Контрольная сумма');
    expect(backupsRepo.find(o.db, id)).toMatchObject({ verifyOk: false });
  });

  it('потерянный файл — не «ок»', async () => {
    const { dir, o } = await setup();
    const { id, row } = await makeBackup(o);
    rmSync(join(dir, 'backups', row.fileName!));
    expect(await backupAdmin.verify(admin, id, o)).toMatchObject({ ok: false });
  });
});

describe('скачивание: только по праву и одноразовой ссылке', () => {
  it('ссылка одноразовая, не раскрывает пути и отдаёт нужный файл', async () => {
    const { dir, o } = await setup();
    const { id, row } = await makeBackup(o);
    const link = backupAdmin.downloadLink(admin, id, o);
    expect(link.path).toMatch(/^\/admin\/api\/backup\/download\?token=[0-9a-f]{64}$/);
    expect(link.path).not.toContain(dir);
    const token = link.path.split('=')[1]!;
    const got = backupAdmin.consumeDownload(admin, token, o);
    expect(got.downloadName).toBe(row.fileName);
    expect(got.file).toBe(join(dir, 'backups', row.fileName!));
    expect(() => backupAdmin.consumeDownload(admin, token, o)).toThrow(NotFoundError); // уже использована
  });

  it('просроченная, чужая и поддельная ссылки не работают; в БД только хеш токена', async () => {
    const { db, o } = await setup();
    const { id } = await makeBackup(o);
    const t1 = backupAdmin.downloadLink(admin, id, o).path.split('=')[1]!;
    expect(() => backupAdmin.consumeDownload(admin, t1, { ...o, now: o.now + 6 * 60_000 })).toThrow(NotFoundError);
    const t2 = backupAdmin.downloadLink(admin, id, o).path.split('=')[1]!;
    const other: StaffSession = { ...admin, staffId: 99 };
    expect(() => backupAdmin.consumeDownload(other, t2, o)).toThrow(NotFoundError);
    expect(() => backupAdmin.consumeDownload(admin, 'x'.repeat(64), o)).toThrow(NotFoundError);
    expect(() => backupAdmin.consumeDownload(admin, '../../etc/passwd', o)).toThrow(NotFoundError);
    const stored = (db.prepare('SELECT token_hash FROM backup_download_tokens').all() as { token_hash: string }[]).map((r) => r.token_hash);
    expect(stored).not.toContain(t1);
    expect(stored).not.toContain(t2);
  });

  it('копия-ошибка не скачивается', async () => {
    const { o } = await setup();
    const id = backupsRepo.insert(o.db, { kind: 'manual', createdBy: 1, now: o.now });
    backupsRepo.markError(o.db, id, 'x', o.now);
    expect(() => backupAdmin.downloadLink(admin, id, o)).toThrow(ConflictError);
  });
});

describe('права backup.run / settings.write', () => {
  it('менеджер и аноним не могут ничего', async () => {
    const { o } = await setup();
    const { id } = await makeBackup(o);
    expect(() => backupAdmin.list(manager, { limit: 5, offset: 0 }, o)).toThrow(ForbiddenError);
    expect(() => backupAdmin.start(manager, o)).toThrow(ForbiddenError);
    await expect(backupAdmin.verify(manager, id, o)).rejects.toThrow(ForbiddenError);
    expect(() => backupAdmin.downloadLink(manager, id, o)).toThrow(ForbiddenError);
    expect(() => backupAdmin.consumeDownload(manager, 'a'.repeat(64), o)).toThrow(ForbiddenError);
    await expect(backupAdmin.requestRestore(manager, { id, confirmWord: RESTORE_WORD, password: PASSWORD }, o)).rejects.toThrow(ForbiddenError);
    expect(() => backupAdmin.cancelRestore(manager, o)).toThrow(ForbiddenError);
    expect(() => backupAdmin.list(null, { limit: 5, offset: 0 }, o)).toThrow(UnauthorizedError);
  });

  it('для восстановления одного backup.run мало: нужен и settings.write', async () => {
    const { o } = await setup();
    const { id } = await makeBackup(o);
    const partial: StaffSession = { staffId: 1, email: 'boss@shop.test', name: 'Админ', role: 'custom', permissions: ['backup.run'] };
    await expect(backupAdmin.requestRestore(partial, { id, confirmWord: RESTORE_WORD, password: PASSWORD }, o)).rejects.toThrow(ForbiddenError);
    expect(() => backupAdmin.start(partial, { ...o, now: o.now + 10_000 })).not.toThrow();
  });
});

describe('восстановление: двухшаговое подтверждение', () => {
  it('нужны точное слово и верный пароль; ничего не создаётся при отказе', async () => {
    const { dir, o } = await setup();
    const { id } = await makeBackup(o);
    await expect(backupAdmin.requestRestore(admin, { id, confirmWord: 'восстановить', password: PASSWORD }, o)).rejects.toThrow(ValidationError);
    await expect(backupAdmin.requestRestore(admin, { id, confirmWord: RESTORE_WORD, password: 'неверный-пароль' }, o)).rejects.toThrow(ValidationError);
    expect(readPendingRestore(dir)).toBeNull();
    expect(o.db.prepare("SELECT COUNT(*) AS n FROM backups WHERE kind = 'pre_restore'").get()).toEqual({ n: 0 });
    expect(o.db.prepare("SELECT result FROM audit_log WHERE action = 'backup.restore_denied'").all().length).toBe(1);
  });

  it('успешный запрос: копия «до восстановления» создана, метка стоит, данные ещё не тронуты', async () => {
    const { dir, o } = await setup();
    const { id } = await makeBackup(o);
    const r = await backupAdmin.requestRestore(admin, { id, confirmWord: RESTORE_WORD, password: PASSWORD }, { ...o, now: o.now + 60_000 });
    expect(backupsRepo.find(o.db, r.preRestoreId)).toMatchObject({ kind: 'pre_restore', status: 'ok' });
    expect(readPendingRestore(dir)).toMatchObject({ backupId: id, requestedBy: 1 });
    expect(() => backupAdmin.start(admin, { ...o, now: o.now + 120_000 })).not.toThrow(); // приложение работает как прежде
  });

  it('повторный запрос при уже стоящей метке отклоняется; отмена снимает метку', async () => {
    const { dir, o } = await setup();
    const { id } = await makeBackup(o);
    await backupAdmin.requestRestore(admin, { id, confirmWord: RESTORE_WORD, password: PASSWORD }, { ...o, now: o.now + 60_000 });
    await expect(backupAdmin.requestRestore(admin, { id, confirmWord: RESTORE_WORD, password: PASSWORD }, { ...o, now: o.now + 61_000 })).rejects.toThrow(ConflictError);
    expect(backupAdmin.cancelRestore(admin, o)).toBe(true);
    expect(readPendingRestore(dir)).toBeNull();
  });

  it('испорченная копия не принимается к восстановлению', async () => {
    const { dir, o } = await setup();
    const { id, row } = await makeBackup(o);
    appendFileSync(join(dir, 'backups', row.fileName!), Buffer.from('x'));
    // contents изменены, но имя файла и запись на месте: проверка внутри запроса ловит повреждение
    await expect(backupAdmin.requestRestore(admin, { id, confirmWord: RESTORE_WORD, password: PASSWORD }, o)).rejects.toThrow(ConflictError);
    expect(readPendingRestore(dir)).toBeNull();
  });

  it('применение при старте: данные возвращаются к состоянию копии, прежнее сохранено в pre-restore-*', async () => {
    const { dir, db, databasePath, o } = await setup();
    db.prepare("INSERT INTO shop_settings (key, value, updated_at) VALUES ('marker', 'до копии', 1)").run();
    const { id } = await makeBackup(o);
    db.prepare("UPDATE shop_settings SET value = 'после копии' WHERE key = 'marker'").run();
    await backupAdmin.requestRestore(admin, { id, confirmWord: RESTORE_WORD, password: PASSWORD }, { ...o, now: o.now + 60_000 });
    db.close(); // как при остановке приложения
    const applied = await applyPendingRestore({ dataDir: dir, databasePath, now: o.now + 120_000 });
    expect(applied?.ok).toBe(true);
    expect(readPendingRestore(dir)).toBeNull();
    const restored = openDatabase(databasePath);
    dbs.push(restored);
    expect(restored.prepare("SELECT value FROM shop_settings WHERE key = 'marker'").get()).toEqual({ value: 'до копии' });
    expect(existsSync(join(dir, `pre-restore-${new Date(o.now + 120_000).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')}`))).toBe(true);
  });

  it('сбой применения: метка уходит в *.failed.json, повторов нет, данные целы', async () => {
    const { dir, db, databasePath } = await setup();
    db.prepare("INSERT INTO shop_settings (key, value, updated_at) VALUES ('marker', 'жив', 1)").run();
    db.close();
    writeFileSync(join(dir, 'pending-restore.json'), JSON.stringify({ backupFile: 'rts-backup-20260101-000000.tar.gz', backupId: 1, requestedBy: 1, requestedAt: 1 }));
    const r = await applyPendingRestore({ dataDir: dir, databasePath });
    expect(r).toMatchObject({ ok: false });
    expect(existsSync(join(dir, 'pending-restore.failed.json'))).toBe(true);
    expect(readPendingRestore(dir)).toBeNull();
    const again = openDatabase(databasePath);
    dbs.push(again);
    expect(again.prepare("SELECT value FROM shop_settings WHERE key = 'marker'").get()).toEqual({ value: 'жив' });
  });

  it('имя файла в метке не может вести за пределы папки копий', async () => {
    const { dir, db, databasePath } = await setup();
    db.close();
    writeFileSync(join(dir, 'pending-restore.json'), JSON.stringify({ backupFile: '../../evil.tar.gz', backupId: null, requestedBy: null, requestedAt: 1 }));
    expect(await applyPendingRestore({ dataDir: dir, databasePath })).toMatchObject({ ok: false });
  });
});

describe('интерфейс и документы отличают копию БД от экспорта товаров', () => {
  it('страница копий и docs/backup-restore.md прямо говорят, что экспорт товаров — не резервная копия', () => {
    const doc = readFileSync(join(process.cwd(), 'docs', 'backup-restore.md'), 'utf8');
    expect(doc).toMatch(/экспорт товаров[^.]*не[^.]*резервн/i);
    const page = readFileSync(join(process.cwd(), 'src', 'app', 'admin', '(panel)', 'settings', 'backup', 'page.tsx'), 'utf8');
    expect(page).toMatch(/экспорт товаров/i);
    expect(page).toMatch(/не является резервной копией/);
  });
});
