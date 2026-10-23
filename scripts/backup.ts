import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

/**
 * Резервная копия: один файл rts-backup-YYYYMMDD-HHMMSS.tar.gz (открывается обычным `tar -xf` и 7-Zip).
 * Состав: rts.sqlite (согласованная копия через VACUUM INTO, пока приложение работает), uploads/, onec-outbox/, manifest.json
 * (версия формата, SHA-256 каждого файла, версия миграций). Файла .env и секретов в архиве нет — храните их отдельно.
 * Внимание: в БД есть персональные данные покупателей и хеши паролей — архив хранить так же бережно, как саму БД.
 */

export const BACKUP_FORMAT = 'rts-backup';
export const BACKUP_VERSION = 1;
/** Каталоги данных, которые входят в копию (всё остальное в папке данных — нет). */
export const BACKUP_DIRS = ['uploads', 'onec-outbox'] as const;

export type TarEntry = { name: string; data?: Buffer; path?: string };
export type ArchiveEntry = { name: string; size: number };

const BLOCK = 512;

function octal(value: number, length: number): Buffer {
  const b = Buffer.alloc(length);
  b.write(value.toString(8).padStart(length - 1, '0'), 0, 'ascii');
  return b;
}

/** Разбивает длинный путь на prefix/name по правилам ustar (name ≤ 100, prefix ≤ 155). */
function splitName(name: string): { prefix: string; base: string } {
  if (Buffer.byteLength(name) <= 100) return { prefix: '', base: name };
  for (let i = name.indexOf('/'); i !== -1; i = name.indexOf('/', i + 1)) {
    const prefix = name.slice(0, i);
    const base = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(base) <= 100) return { prefix, base };
  }
  throw new Error(`Слишком длинный путь для архива: ${name.slice(0, 60)}…`);
}

function header(name: string, size: number, mtimeSec: number): Buffer {
  const h = Buffer.alloc(BLOCK);
  const { prefix, base } = splitName(name);
  h.write(base, 0, 'utf8');
  octal(0o644, 8).copy(h, 100);
  octal(0, 8).copy(h, 108);
  octal(0, 8).copy(h, 116);
  octal(size, 12).copy(h, 124);
  octal(mtimeSec, 12).copy(h, 136);
  h.fill(0x20, 148, 156); // место контрольной суммы считается пробелами
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  h.write(prefix, 345, 'utf8');
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return h;
}

async function* tarChunks(entries: TarEntry[]): AsyncGenerator<Buffer> {
  const mtime = Math.floor(Date.now() / 1000);
  for (const e of entries) {
    if (e.data) {
      yield header(e.name, e.data.length, mtime);
      yield e.data;
      if (e.data.length % BLOCK) yield Buffer.alloc(BLOCK - (e.data.length % BLOCK));
    } else if (e.path) {
      const size = statSync(e.path).size;
      yield header(e.name, size, mtime);
      let written = 0;
      for await (const chunk of createReadStream(e.path)) {
        written += (chunk as Buffer).length;
        yield chunk as Buffer;
      }
      if (written !== size) throw new Error(`Файл изменился во время копирования: ${e.name}`);
      if (size % BLOCK) yield Buffer.alloc(BLOCK - (size % BLOCK));
    }
  }
  yield Buffer.alloc(BLOCK * 2);
}

/** Записывает tar.gz (во временный файл, затем переименование — недописанного архива под настоящим именем не бывает). */
export async function writeTarGz(file: string, entries: TarEntry[]): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  try {
    await pipeline(Readable.from(tarChunks(entries)), createGzip({ level: 6 }), createWriteStream(partial));
    renameSync(partial, file);
  } catch (e) {
    rmSync(partial, { force: true });
    throw e;
  }
}

class ChunkReader {
  private buf: Buffer = Buffer.alloc(0);
  private readonly it: AsyncIterator<Buffer>;
  private done = false;
  constructor(source: AsyncIterable<Buffer>) {
    this.it = source[Symbol.asyncIterator]();
  }
  private async fill(n: number): Promise<void> {
    while (this.buf.length < n && !this.done) {
      const r = await this.it.next();
      if (r.done) this.done = true;
      else this.buf = Buffer.concat([this.buf, r.value]);
    }
  }
  /** Ровно n байт; на конце потока — меньше (или пусто). */
  async take(n: number): Promise<Buffer> {
    await this.fill(n);
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(out.length);
    return out;
  }
  /** Потоково отдаёт n байт получателю, не держа файл целиком в памяти. */
  async drain(n: number, sink: (chunk: Buffer) => Promise<void> | void): Promise<void> {
    let left = n;
    while (left > 0) {
      const chunk = await this.take(Math.min(left, 1 << 20));
      if (chunk.length === 0) throw new Error('Архив обрезан');
      await sink(chunk);
      left -= chunk.length;
    }
  }
}

function readString(h: Buffer, from: number, len: number): string {
  const slice = h.subarray(from, from + len);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? len : end).toString('utf8');
}

/** Обходит записи tar.gz по порядку. Для каждой вызывает onEntry с потоковым чтением содержимого. */
export async function walkTarGz(
  file: string,
  onEntry: (e: ArchiveEntry & { type: string; drain: (sink: (c: Buffer) => Promise<void> | void) => Promise<void> }) => Promise<void> | void,
): Promise<void> {
  const reader = new ChunkReader(createReadStream(file).pipe(createGunzip()) as AsyncIterable<Buffer>);
  for (;;) {
    const h = await reader.take(BLOCK);
    if (h.length < BLOCK || h.every((b) => b === 0)) return;
    const stored = parseInt(readString(h, 148, 8).trim() || '0', 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (h[i] as number);
    if (stored !== sum) throw new Error('Архив повреждён: неверная контрольная сумма заголовка');
    const prefix = readString(h, 345, 155);
    const name = prefix ? `${prefix}/${readString(h, 0, 100)}` : readString(h, 0, 100);
    const size = parseInt(readString(h, 124, 12).trim() || '0', 8);
    const type = readString(h, 156, 1) || '0';
    let consumed = false;
    await onEntry({
      name,
      size,
      type,
      drain: async (sink) => {
        consumed = true;
        await reader.drain(size, sink);
      },
    });
    if (!consumed) await reader.drain(size, () => undefined);
    if (size % BLOCK) await reader.take(BLOCK - (size % BLOCK));
  }
}

/** Список файлов архива (без чтения содержимого в память). */
export async function listArchive(file: string): Promise<ArchiveEntry[]> {
  const out: ArchiveEntry[] = [];
  await walkTarGz(file, (e) => {
    if (e.type === '0') out.push({ name: e.name, size: e.size });
  });
  return out;
}

function walkFiles(root: string, rel = ''): string[] {
  const dir = rel ? join(root, rel) : root;
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const relPath = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(root, relPath));
    if (st.isSymbolicLink()) continue; // ссылки наружу в копию не берём
    if (st.isDirectory()) out.push(...walkFiles(root, relPath));
    else if (st.isFile()) out.push(relPath);
  }
  return out;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const pad = (n: number) => String(n).padStart(2, '0');
export function backupFileName(now: number): string {
  const d = new Date(now);
  return `rts-backup-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.tar.gz`;
}

export type BackupResult = { file: string; bytes: number; files: number; migrationVersion: number | null };

/**
 * Создаёт копию. Работает при запущенном приложении: VACUUM INTO даёт согласованный снимок БД (включая данные из WAL),
 * приложению он не мешает. Исходные файлы не меняются.
 */
export async function createBackup(o: { databasePath: string; dataDir: string; outDir?: string; now?: number }): Promise<BackupResult> {
  const databasePath = resolve(o.databasePath);
  const dataDir = resolve(o.dataDir);
  if (!existsSync(databasePath)) throw new Error('Файл базы данных не найден — нечего копировать. Сначала выполните npm run db:migrate.');
  const outDir = resolve(o.outDir ?? join(dataDir, 'backups'));
  mkdirSync(outDir, { recursive: true });
  const stage = join(outDir, `.stage-${randomBytes(6).toString('hex')}`);
  mkdirSync(stage);
  try {
    const snapshot = join(stage, 'rts.sqlite');
    const src = new DatabaseSync(databasePath);
    try {
      src.exec('PRAGMA busy_timeout = 5000');
      src.prepare('VACUUM INTO ?').run(snapshot);
    } finally {
      src.close();
    }
    // проверяем сам снимок, а не источник
    const copy = new DatabaseSync(snapshot, { readOnly: true });
    let migrationVersion: number | null = null;
    try {
      const check = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      if (check.integrity_check !== 'ok') throw new Error('Снимок базы данных не прошёл проверку целостности');
      const v = copy.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null } | undefined;
      migrationVersion = v?.v ?? null;
    } finally {
      copy.close();
    }

    const entries: TarEntry[] = [{ name: 'rts.sqlite', path: snapshot }];
    for (const dir of BACKUP_DIRS) {
      const root = join(dataDir, dir);
      if (!existsSync(root)) continue;
      for (const rel of walkFiles(root)) entries.push({ name: `${dir}/${rel}`, path: join(root, rel) });
    }
    const files: Record<string, string> = {};
    for (const e of entries) files[e.name] = await sha256File(e.path as string);
    const manifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date(o.now ?? Date.now()).toISOString(),
      migrationVersion,
      files,
    };
    entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });

    const file = join(outDir, backupFileName(o.now ?? Date.now()));
    await writeTarGz(file, entries);
    return { file, bytes: statSync(file).size, files: entries.length - 1, migrationVersion };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const { existsSync: exists } = await import('node:fs');
  if (exists('.env')) process.loadEnvFile('.env');
  const { getConfig } = await import('../src/server/config');
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx !== -1 ? args[outIdx + 1] : undefined;
  if (args.some((a) => a.startsWith('--') && a !== '--out') || (outIdx !== -1 && !outDir)) {
    console.error('Использование: npm run backup [-- --out <папка>]\nПо умолчанию копия кладётся в data/backups/.');
    return 2;
  }
  const cfg = getConfig();
  try {
    const r = await createBackup({ databasePath: cfg.databasePath, dataDir: cfg.dataDir, outDir });
    console.log(`Резервная копия создана: ${r.file}`);
    console.log(`Размер: ${(r.bytes / 1024 / 1024).toFixed(2)} МБ, файлов: ${r.files}, версия миграций: ${r.migrationVersion ?? 'нет'}`);
    console.log('В копии нет .env и секретов (храните их отдельно). В БД есть данные покупателей — берегите архив так же, как базу.');
    return 0;
  } catch (e) {
    console.error(`Не удалось создать копию: ${e instanceof Error ? e.message : 'внутренняя ошибка'}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
