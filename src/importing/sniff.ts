import { ImportFileError } from './yml/parse';

export type ImportFormat = 'yml' | 'csv';

/**
 * Формат по СОДЕРЖИМОМУ файла, не по расширению: разметка с <yml_catalog> — YML; текст без разметки — CSV.
 * HTML/другой XML, JSON и пустой файл отвергаются с понятным сообщением.
 */
export function detectFormat(text: string): ImportFormat {
  const t = text.replace(/^﻿/, '').trimStart();
  if (t === '') throw new ImportFileError('Файл пустой');
  if (t.startsWith('<')) {
    if (/<yml_catalog[\s>]/i.test(t.slice(0, 200_000)) || /<offers[\s>]/i.test(t.slice(0, 200_000))) return 'yml';
    throw new ImportFileError('Это не YML-каталог (нет <yml_catalog>). Загрузите выгрузку каталога или CSV-таблицу.');
  }
  if (t.startsWith('{') || t.startsWith('[{') || t.startsWith('%PDF')) throw new ImportFileError('Нужен файл CSV или YML. Этот формат не поддерживается.');
  return 'csv';
}
