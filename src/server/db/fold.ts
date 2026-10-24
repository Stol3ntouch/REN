import type { Db } from './connection';

const folded = new WeakSet<Db>();

/** Регистрирует регистронезависимое сравнение для кириллицы (NOCASE в SQLite знает только ASCII): SQL-функция rts_fold. */
export function ensureFold(db: Db): void {
  if (folded.has(db)) return;
  db.function('rts_fold', { deterministic: true }, (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е'),
  );
  folded.add(db);
}

/** Нижний регистр и ё → е — тот же вид, что даёт rts_fold; для шаблонов LIKE. */
export function foldText(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

/** Шаблон LIKE «содержит» с экранированием спецсимволов (использовать с ESCAPE '\'). */
export function likeContains(s: string): string {
  return `%${foldText(s).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
