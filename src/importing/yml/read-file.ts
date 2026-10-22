import { readFileSync, statSync } from 'node:fs';
import { ImportFileError } from './parse';
import { MAX_IMPORT_BYTES } from './types';

/** Читает файл импорта с проверкой размера до чтения в память (≤20 МБ). */
export function readImportFile(path: string): string {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new ImportFileError(`Файл не найден: ${path}`);
  }
  if (size > MAX_IMPORT_BYTES) throw new ImportFileError('Файл больше 20 МБ');
  return readFileSync(path, 'utf8');
}
