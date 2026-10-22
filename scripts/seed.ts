import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeDb, getDb, type Db } from '../src/server/db/connection';

if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * dev-данные (не секреты). Каждый файл scripts/seed/*.ts экспортирует default (db) => void
 * и запускается по порядку имён; новые задачи добавляют свой файл, не правя этот.
 * Сиды должны быть идемпотентными (повторный запуск ничего не дублирует).
 */
async function main(): Promise<void> {
  const dir = join(process.cwd(), 'scripts', 'seed');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const db = getDb();

  for (const file of files) {
    const mod = (await import(pathToFileURL(join(dir, file)).href)) as { default: (db: Db) => void };
    mod.default(db);
    console.log(`seed: ${file}`);
  }
  console.log(`Готово. Наборов данных: ${files.length}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
