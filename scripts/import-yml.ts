import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { applyImport, ImportFileError, parseYml, planImport, readImportFile, recordPreview } from '../src/importing/yml';
import type { RowError } from '../src/importing/yml';
import { closeDb, getDb } from '../src/server/db/connection';

// Переменные из .env (если есть); Next.js делает это сам, скрипты — нет.
if (existsSync('.env')) process.loadEnvFile('.env');

const USAGE = `Использование: npm run import:yml -- <файл.yml> [--preview] [--images]
  --preview  только предпросмотр (создано / обновится / пропущено / ошибки), каталог не меняется
  --images   скачивать фото (по умолчанию выключено; хранятся только ссылки). Нужна сеть; хосты — IMAGE_HOST_ALLOWLIST (по умолчанию champion.ru)`;

function printErrors(errors: RowError[]): void {
  if (errors.length === 0) return;
  const byKind = new Map<string, number>();
  for (const e of errors) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  console.log(`Ошибки по строкам: ${errors.length} (${[...byKind].map(([k, n]) => `${k}: ${n}`).join(', ')})`);
  for (const e of errors.slice(0, 20)) console.log(`  - [${e.kind}] ${e.message}`);
  if (errors.length > 20) console.log(`  … и ещё ${errors.length - 20} (полный список — в таблице import_runs)`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const files = args.filter((a) => !a.startsWith('--'));
  const unknown = [...flags].filter((f) => f !== '--preview' && f !== '--images');
  if (files.length !== 1 || unknown.length > 0) {
    console.error(unknown.length > 0 ? `Неизвестные флаги: ${unknown.join(' ')}\n${USAGE}` : USAGE);
    return 2;
  }
  const path = files[0] as string;

  let parsed;
  try {
    parsed = parseYml(readImportFile(path));
  } catch (e) {
    if (e instanceof ImportFileError) {
      console.error(`Файл отклонён: ${e.message}`);
      return 1;
    }
    throw e;
  }

  const db = getDb();
  const plan = planImport(parsed, db, { fileName: basename(path) });
  const s = plan.summary;
  console.log(`Предпросмотр ${plan.fileName}:`);
  console.log(`  категории: создать ${s.categories.create}, обновить ${s.categories.update}, без изменений ${s.categories.unchanged}`);
  console.log(`  товары:    создать ${s.products.create}, обновить ${s.products.update}, без изменений ${s.products.unchanged}`);
  console.log(`  ошибок: ${s.errors}`);

  if (flags.has('--preview')) {
    recordPreview(plan, db);
    printErrors(plan.errors);
    return 0;
  }

  const report = await applyImport(plan, db, { images: flags.has('--images') ? {} : false });
  console.log('Применено:');
  console.log(`  категории: создано ${report.categories.created}, изменено ${report.categories.updated}, без изменений ${report.categories.unchanged}`);
  console.log(`  товары:    создано ${report.products.created}, изменено ${report.products.updated}, без изменений ${report.products.unchanged}` + (report.products.lockedFieldsSkipped > 0 ? `, закреплённых полей пропущено ${report.products.lockedFieldsSkipped}` : ''));
  console.log(
    report.images.enabled
      ? `  фото: сохранено ${report.images.stored}, не удалось ${report.images.failed}, осталось ${report.images.pending}`
      : `  фото: не скачивались (флаг --images выключен), ссылок ждёт скачивания ${report.images.pending}`,
  );
  printErrors(report.errors);
  console.log(`Запись журнала: import_runs #${report.runId}`);
  return 0;
}

main()
  .then((code) => {
    closeDb();
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    closeDb();
    process.exitCode = 1;
  });
