import { randomBytes } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_DIRS, BACKUP_FORMAT, BACKUP_VERSION, sha256File, walkTarGz } from './backup';

export type RestoreResult = { files: number; previousDir: string | null; migrationVersion: number | null };

const ALLOWED = new RegExp(`^(rts\\.sqlite|manifest\\.json|(${BACKUP_DIRS.join('|')})/[^\\\\:]+)$`);

/** Имя из архива: только внутри разрешённых каталогов, без «..», абсолютных путей и обратных слэшей. */
function assertSafeName(name: string): void {
  const parts = name.split('/');
  if (!ALLOWED.test(name) || parts.some((p) => p === '' || p === '.' || p === '..') || name.startsWith('/')) {
    throw new Error(`Архив содержит недопустимый путь: ${name.slice(0, 80)}`);
  }
}

function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

const stamp = (now: number) => new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

/**
 * Распаковывает копию во временную папку и проверяет её целиком: безопасные пути, манифест, SHA-256 каждого файла, integrity_check базы.
 * Ничего не заменяет. Используется и восстановлением, и кнопкой «Проверить» в админке.
 */
export async function unpackAndVerify(file: string, stage: string): Promise<{ names: string[]; listed: string[]; migrationVersion: number | null }> {
    // 1. распаковка
    const names: string[] = [];
    await walkTarGz(file, async (e) => {
      if (e.type === '5') return; // каталоги создаются по файлам
      if (e.type !== '0') throw new Error(`Архив содержит недопустимый тип записи: ${e.name.slice(0, 80)}`);
      assertSafeName(e.name);
      const target = join(stage, ...e.name.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      const out = createWriteStream(target);
      await e.drain((c) => new Promise<void>((res, rej) => out.write(c, (err) => (err ? rej(err) : res()))));
      await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
      names.push(e.name);
    });

    // 2. сверка с манифестом
    if (!names.includes('manifest.json')) throw new Error('В архиве нет manifest.json — это не резервная копия РемТехСад');
    const manifest = JSON.parse(readFileSync(join(stage, 'manifest.json'), 'utf8')) as { format?: string; version?: number; files?: Record<string, string> };
    if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION || !manifest.files) throw new Error('Неподдерживаемый формат копии');
    const listed = Object.keys(manifest.files).sort();
    const present = names.filter((n) => n !== 'manifest.json').sort();
    if (listed.join('\n') !== present.join('\n')) throw new Error('Состав архива не совпадает с manifest.json — копия повреждена');
    if (!listed.includes('rts.sqlite')) throw new Error('В архиве нет базы данных');
    for (const n of listed) {
      if ((await sha256File(join(stage, ...n.split('/')))) !== manifest.files[n]) throw new Error(`Контрольная сумма не совпала: ${n} — копия повреждена`);
    }
    let migrationVersion: number | null = null;
    const db = new DatabaseSync(join(stage, 'rts.sqlite'), { readOnly: true });
    try {
      const check = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      if (check.integrity_check !== 'ok') throw new Error('База в копии не прошла проверку целостности');
      migrationVersion = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v;
    } finally {
      db.close();
    }


  return { names, listed, migrationVersion };
}

/** Только проверка: распаковка во временную папку, сверка, удаление. Бросает Error с понятным текстом при повреждении. */
export async function verifyBackupArchive(file: string, tmpRoot: string): Promise<{ files: number; migrationVersion: number | null }> {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new Error('Файл копии не найден');
  mkdirSync(tmpRoot, { recursive: true });
  const stage = join(tmpRoot, `.verify-${randomBytes(6).toString('hex')}`);
  mkdirSync(stage);
  try {
    const r = await unpackAndVerify(abs, stage);
    return { files: r.listed.length, migrationVersion: r.migrationVersion };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export const PENDING_RESTORE_FILE = 'pending-restore.json';

export type PendingRestore = { backupFile: string; backupId: number | null; requestedBy: number | null; requestedAt: number };

/** Запрос на восстановление: файл-метка в папке данных. Применяется при следующем запуске приложения (или командой restore --pending). */
export function writePendingRestore(dataDir: string, p: PendingRestore): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(resolve(dataDir), PENDING_RESTORE_FILE), JSON.stringify(p), 'utf8');
}

export function readPendingRestore(dataDir: string): PendingRestore | null {
  try {
    const v = JSON.parse(readFileSync(join(resolve(dataDir), PENDING_RESTORE_FILE), 'utf8')) as Partial<PendingRestore>;
    if (typeof v.backupFile !== 'string' || typeof v.requestedAt !== 'number') return null;
    return { backupFile: v.backupFile, backupId: v.backupId ?? null, requestedBy: v.requestedBy ?? null, requestedAt: v.requestedAt };
  } catch {
    return null;
  }
}

export function cancelPendingRestore(dataDir: string): boolean {
  const f = join(resolve(dataDir), PENDING_RESTORE_FILE);
  if (!existsSync(f)) return false;
  rmSync(f, { force: true });
  return true;
}

export type AppliedRestore = { ok: true; result: RestoreResult; request: PendingRestore } | { ok: false; error: string; request: PendingRestore };

/**
 * Применяет отложенное восстановление, если оно запрошено. Вызывать до открытия БД (при старте процесса).
 * Файл копии берётся только из <data>/backups по имени (без путей). При сбое метка переименовывается в *.failed.json, повторов в цикле нет.
 */
export async function applyPendingRestore(o: { dataDir: string; databasePath: string; now?: number }): Promise<AppliedRestore | null> {
  const request = readPendingRestore(o.dataDir);
  if (!request) return null;
  const marker = join(resolve(o.dataDir), PENDING_RESTORE_FILE);
  const name = basename(request.backupFile);
  try {
    if (!/^rts-backup-[0-9-]+.tar.gz$/.test(name)) throw new Error('Недопустимое имя файла копии');
    const result = await restoreBackup({ file: join(resolve(o.dataDir), 'backups', name), databasePath: o.databasePath, dataDir: o.dataDir, force: true, now: o.now });
    rmSync(marker, { force: true });
    return { ok: true, result, request };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'внутренняя ошибка';
    try {
      renameSync(marker, join(resolve(o.dataDir), 'pending-restore.failed.json'));
    } catch {
      rmSync(marker, { force: true });
    }
    return { ok: false, error, request };
  }
}

/**
 * Восстановление из rts-backup-*.tar.gz. Порядок: проверка → распаковка во временную папку → сверка SHA-256 и
 * integrity_check → прежние БД/uploads/onec-outbox переносятся в <data>/pre-restore-<время>/ (не удаляются) → новые встают на место.
 * Если на любом шаге замены сбой — прежнее возвращается. Сервер на время восстановления остановите.
 */
export async function restoreBackup(o: { file: string; databasePath: string; dataDir: string; force?: boolean; now?: number }): Promise<RestoreResult> {
  const file = resolve(o.file);
  const databasePath = resolve(o.databasePath);
  const dataDir = resolve(o.dataDir);
  if (!existsSync(file)) throw new Error('Файл копии не найден');

  const hasData = existsSync(databasePath) || BACKUP_DIRS.some((d) => existsSync(join(dataDir, d)));
  if (hasData && !o.force) {
    throw new Error('В папке данных уже есть база или файлы. Остановите сервер и повторите с флагом --force: прежнее состояние будет сохранено в pre-restore-*, не удалено.');
  }

  mkdirSync(dataDir, { recursive: true });
  const stage = join(dataDir, `.restore-${randomBytes(6).toString('hex')}`);
  mkdirSync(stage);
  try {
    const { listed, migrationVersion } = await unpackAndVerify(file, stage);

    // 3. замена: прежнее — в pre-restore, новое — на место; при сбое возврат
    const previousDir = hasData ? join(dataDir, `pre-restore-${stamp(o.now ?? Date.now())}`) : null;
    const moved: { from: string; to: string }[] = [];
    try {
      if (previousDir) {
        mkdirSync(previousDir, { recursive: true });
        const old = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, ...BACKUP_DIRS.map((d) => join(dataDir, d))];
        for (const p of old) {
          if (!existsSync(p)) continue;
          const to = join(previousDir, basename(p));
          moveFile(p, to);
          moved.push({ from: p, to });
        }
      }
      mkdirSync(dirname(databasePath), { recursive: true });
      moveFile(join(stage, 'rts.sqlite'), databasePath);
      for (const d of BACKUP_DIRS) if (existsSync(join(stage, d))) renameSync(join(stage, d), join(dataDir, d));
    } catch (e) {
      rmSync(databasePath, { force: true });
      for (const d of BACKUP_DIRS) if (!moved.some((m) => m.from === join(dataDir, d))) rmSync(join(dataDir, d), { recursive: true, force: true });
      for (const m of moved.reverse()) {
        try {
          moveFile(m.to, m.from);
        } catch {
          /* остаётся в pre-restore — путь указан в сообщении */
        }
      }
      throw new Error(`Не удалось заменить данные (${(e as NodeJS.ErrnoException).code ?? 'ошибка'}). Остановите сервер и повторите. Прежнее состояние возвращено${previousDir ? `, при сомнениях проверьте ${previousDir}` : ''}.`);
    }
    return { files: listed.length, previousDir, migrationVersion };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { getConfig } = await import('../src/server/config');
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  if (args.includes('--pending')) {
    const cfgP = (await import('../src/server/config')).getConfig();
    const r = await applyPendingRestore({ dataDir: cfgP.dataDir, databasePath: cfgP.databasePath });
    if (!r) {
      console.log('Запроса на восстановление нет.');
      return 0;
    }
    if (!r.ok) {
      console.error(`Не удалось восстановить: ${r.error}`);
      return 1;
    }
    console.log(`Восстановлено файлов: ${r.result.files}. Прежнее состояние: ${r.result.previousDir ?? 'нет'}.`);
    return 0;
  }
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length !== 1 || args.some((a) => a.startsWith('--') && a !== '--force')) {
    console.error('Использование: npm run restore -- <файл.tar.gz> [--force]  |  npm run restore -- --pending (запрос из админки)\n--force нужен, если в data/ уже есть база; прежнее состояние сохраняется в data/pre-restore-*. Сервер остановите.');
    return 2;
  }
  const cfg = getConfig();
  try {
    const r = await restoreBackup({ file: files[0] as string, databasePath: cfg.databasePath, dataDir: cfg.dataDir, force });
    console.log(`Восстановлено файлов: ${r.files}, версия миграций в копии: ${r.migrationVersion ?? 'нет'}.`);
    if (r.previousDir) console.log(`Прежнее состояние сохранено: ${r.previousDir}`);
    console.log('Запустите сервер: npm run dev (или start). Недостающие миграции применятся при старте.');
    return 0;
  } catch (e) {
    console.error(`Не удалось восстановить: ${e instanceof Error ? e.message : 'внутренняя ошибка'}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
