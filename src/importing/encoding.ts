import { ImportFileError } from './yml/parse';

export type TextEncodingName = 'utf-8' | 'windows-1251';
export type EncodingChoice = 'auto' | TextEncodingName;

/**
 * Байты файла → текст. auto: BOM UTF-8 → UTF-8; байты, которые строго читаются как UTF-8, → UTF-8; иначе windows-1251.
 * Кодировку можно задать вручную (мастер даёт поправить выбор). BOM снимается. Файл с нулевыми байтами — не текст.
 */
export function decodeBytes(bytes: Uint8Array, choice: EncodingChoice = 'auto'): { text: string; encoding: TextEncodingName } {
  const head = bytes.subarray(0, 4096);
  if (head.includes(0)) throw new ImportFileError('Файл не похож на текстовый (CSV или YML). Сохраните таблицу как CSV и загрузите снова.');
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  const utf8 = () => new TextDecoder('utf-8', { fatal: true }).decode(body);
  const cp1251 = () => new TextDecoder('windows-1251').decode(body);
  if (choice === 'windows-1251') return { text: cp1251(), encoding: 'windows-1251' };
  if (choice === 'utf-8') return { text: new TextDecoder('utf-8').decode(body), encoding: 'utf-8' };
  try {
    return { text: utf8(), encoding: 'utf-8' };
  } catch {
    return { text: cp1251(), encoding: 'windows-1251' };
  }
}
