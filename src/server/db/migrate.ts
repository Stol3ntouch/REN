import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './connection';
import { withTransaction } from './transaction';

const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

type MigrationFile = { version: number; name: string; checksum: string; sql: string };

/** Каталог миграций проекта (запуск всегда из корня проекта). */
export function defaultMigrationsDir(): string {
  return join(process.cwd(), 'migrations');
}

function loadFiles(dir: string): MigrationFile[] {
  const files: MigrationFile[] = [];
  const seen = new Map<number, string>();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;
    const m = FILE_RE.exec(file);
    if (!m) throw new Error(`Миграция ${file}: имя должно быть вида NNNN_name.sql`);
    const version = Number(m[1]);
    const clash = seen.get(version);
    if (clash) throw new Error(`Номер миграции ${m[1]} занят дважды: ${clash} и ${file}`);
    seen.set(version, file);
    // CRLF и LF дают одну и ту же контрольную сумму (git autocrlf на Windows).
    const sql = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    files.push({
      version,
      name: file.replace(/\.sql$/, ''),
      checksum: createHash('sha256').update(sql).digest('hex'),
      sql,
    });
  }
  return files;
}

function ensureTable(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
}

/** Наибольший применённый номер миграции; 0, если ничего не применено. */
export function getMigrationVersion(db: Db): number {
  const table = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

/**
 * Применяет ещё не применённые миграции из dir, каждую в своей транзакции.
 * Порядок — по номеру; «опоздавшая» миграция с меньшим номером тоже применяется.
 * Уже применённый файл менять нельзя (сверяется контрольная сумма) — только вперёд.
 */
export function runMigrations(db: Db, opts: { dir?: string } = {}): { applied: string[]; version: number } {
  const files = loadFiles(opts.dir ?? defaultMigrationsDir());
  ensureTable(db);
  const applied: string[] = [];

  for (const file of files) {
    try {
      withTransaction(db, (tx) => {
        const row = tx.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(file.version) as
          | { checksum: string }
          | undefined;
        if (row) {
          if (row.checksum !== file.checksum) {
            throw new Error('файл изменён после применения; создайте новую миграцию');
          }
          return;
        }
        tx.exec(file.sql);
        tx.prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)').run(
          file.version,
          file.name,
          file.checksum,
        );
        applied.push(file.name);
      });
    } catch (e) {
      throw new Error(`Миграция ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { applied, version: getMigrationVersion(db) };
}
