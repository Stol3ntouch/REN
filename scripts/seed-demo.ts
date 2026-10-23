import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyImport, parseYml, planImport, readImportFile } from '../src/importing/yml';
import { closeDb, getDb, type Db } from '../src/server/db/connection';
import { isProductionEnv } from '../src/server/config';

/**
 * Демо-данные для локальной проверки. Ничего не выдумывает: нет отзывов, рейтингов, остатков числом, тарифов, акций, новостей.
 *  1. Базовые наборы scripts/seed/*.ts (способы доставки/оплаты, тестовая онлайн-оплата — только вне production).
 *  2. Каталог — только настоящий, из YML-файла (--catalog <файл>); без файла каталог остаётся пустым.
 *  Администратор создаётся отдельно: npm run admin:create (пароль не хранится в репозитории и не печатается).
 * Повторный запуск безопасен.
 */
export type SeedDemoResult = { seeds: string[]; catalogProducts: number };

export async function runSeedDemo(db: Db, o: { catalogFile?: string; env?: Record<string, string | undefined> } = {}): Promise<SeedDemoResult> {
  if (isProductionEnv(o.env ?? process.env)) throw new Error('seed:demo не запускается в production: это данные для локальной проверки.');
  const dir = join(process.cwd(), 'scripts', 'seed');
  const seeds = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  for (const file of seeds) {
    const mod = (await import(pathToFileURL(join(dir, file)).href)) as { default: (db: Db) => void };
    mod.default(db);
  }
  if (o.catalogFile) {
    const plan = planImport(parseYml(readImportFile(o.catalogFile)), db, { fileName: basename(o.catalogFile) });
    await applyImport(plan, db, { images: false });
  }
  const catalogProducts = (db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n;
  return { seeds, catalogProducts };
}

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const args = process.argv.slice(2);
  const i = args.indexOf('--catalog');
  const catalogFile = i !== -1 ? args[i + 1] : undefined;
  if (args.some((a) => a.startsWith('--') && a !== '--catalog') || (i !== -1 && !catalogFile)) {
    console.error('Использование: npm run seed:demo [-- --catalog <файл.yml>]');
    return 2;
  }
  try {
    const r = await runSeedDemo(getDb(), { catalogFile });
    console.log(`Наборов данных: ${r.seeds.length}. Товаров в каталоге: ${r.catalogProducts}.`);
    if (r.catalogProducts === 0) console.log('Каталог пуст: загрузите настоящий — npm run import:yml -- <файл.yml> (или повторите с --catalog <файл.yml>).');
    console.log('Администратор: npm run admin:create -- <логин> (пароль вводится скрыто или берётся из переменной ADMIN_PASSWORD).');
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Не удалось подготовить демо-данные');
    return 1;
  } finally {
    closeDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
