import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getConfig } from '../config';
import { runMigrations } from './migrate';

/** Соединение с БД. Диалект скрыт: SQL пишется только в src/server/db/**. */
export type Db = DatabaseSync;

/** Открывает SQLite (файл или ':memory:') с обязательными PRAGMA. */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  return db;
}

// Одно соединение на процесс; в dev переживает горячую перезагрузку модулей.
const globalRef = globalThis as unknown as { __rtsDb?: Db };

/** Соединение приложения: открывает data/rts.sqlite и применяет миграции при первом обращении. */
export function getDb(): Db {
  if (!globalRef.__rtsDb) {
    const db = openDatabase(getConfig().databasePath);
    try {
      runMigrations(db);
    } catch (e) {
      db.close();
      throw e;
    }
    globalRef.__rtsDb = db;
  }
  return globalRef.__rtsDb;
}

export function closeDb(): void {
  globalRef.__rtsDb?.close();
  globalRef.__rtsDb = undefined;
}

export { withTransaction } from './transaction';
