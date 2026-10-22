import { openDatabase, type Db } from './connection';
import { runMigrations } from './migrate';

/**
 * Шов тестов: новая БД в памяти с применёнными миграциями проекта.
 * Каждый вызов — отдельная изолированная база; закрывать не обязательно.
 */
export function createTestDb(opts: { migrationsDir?: string } = {}): Db {
  const db = openDatabase(':memory:');
  runMigrations(db, opts.migrationsDir ? { dir: opts.migrationsDir } : {});
  return db;
}
