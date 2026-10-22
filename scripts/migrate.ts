import { existsSync } from 'node:fs';
import { closeDb, getDb } from '../src/server/db/connection';

// Переменные из .env (если есть); Next.js делает это сам, скрипты — нет.
if (existsSync('.env')) process.loadEnvFile('.env');

// getDb() открывает БД и применяет непримёненные миграции; повторный запуск ничего не меняет.
const db = getDb();
const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as { version: number; name: string }[];
console.log(`Миграции применены. Всего: ${rows.length}, последняя: ${rows.at(-1)?.name ?? 'нет'}`);
closeDb();
