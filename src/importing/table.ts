import { parseCsv, type Delimiter } from './csv';
import { decodeBytes, type EncodingChoice, type TextEncodingName } from './encoding';
import { detectFormat, type ImportFormat } from './sniff';
import { MAX_IMPORT_BYTES } from './limits';
import { ImportFileError } from './yml/parse';

export type SniffResult = { format: ImportFormat; encoding: TextEncodingName; text: string };

/** Проверка размера, кодировки и формата (по содержимому). */
export function sniffFile(bytes: Uint8Array, encoding: EncodingChoice = 'auto'): SniffResult {
  if (bytes.byteLength === 0) throw new ImportFileError('Файл пустой');
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new ImportFileError('Файл больше 20 МБ');
  const { text, encoding: used } = decodeBytes(bytes, encoding);
  return { format: detectFormat(text), encoding: used, text };
}

export type CsvFileTable = {
  encoding: TextEncodingName;
  delimiter: Delimiter;
  headers: string[];
  /** Строки данных (без заголовка). */
  rows: string[][];
};

/** Файл CSV → заголовки и строки. Заголовки обрезаются по краям; пустой заголовок получает имя «Колонка N». */
export function readCsvTable(bytes: Uint8Array, choice: { encoding?: EncodingChoice; delimiter?: Delimiter | 'auto' } = {}): CsvFileTable {
  const { text, encoding, format } = sniffFile(bytes, choice.encoding ?? 'auto');
  if (format !== 'csv') throw new ImportFileError('Это не CSV-файл');
  const parsed = parseCsv(text, { delimiter: choice.delimiter && choice.delimiter !== 'auto' ? choice.delimiter : undefined });
  const [head, ...rows] = parsed.rows;
  if (!head || head.every((h) => h.trim() === '')) throw new ImportFileError('В файле нет строки заголовков');
  const headers = head.map((h, i) => h.replace(/^﻿/, '').trim() || `Колонка ${i + 1}`);
  return { encoding, delimiter: parsed.delimiter, headers, rows };
}
