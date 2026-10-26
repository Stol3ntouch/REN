import { describe, expect, it } from 'vitest';
import { decodeBytes } from '@/importing/encoding';
import { detectDelimiter, parseCsv } from '@/importing/csv';
import { detectFormat } from '@/importing/sniff';
import { ImportFileError } from '@/importing/yml';
import { MAX_IMPORT_ROWS } from '@/importing/limits';
import { csv, encodeCp1251, utf8, utf8Bom } from './csv-helpers';

describe('кодировка файла', () => {
  it('UTF-8 без BOM, UTF-8 с BOM (BOM снимается) и windows-1251 определяются сами', () => {
    expect(decodeBytes(utf8('Цена;Название\r\n'))).toEqual({ text: 'Цена;Название\r\n', encoding: 'utf-8' });
    expect(decodeBytes(utf8Bom('Цена'))).toEqual({ text: 'Цена', encoding: 'utf-8' });
    expect(decodeBytes(encodeCp1251('Цена;Название — «Ёлка»'))).toEqual({ text: 'Цена;Название — «Ёлка»', encoding: 'windows-1251' });
  });

  it('кодировку можно задать вручную; бинарный файл отвергается', () => {
    const bytes = encodeCp1251('Привет');
    expect(decodeBytes(bytes, 'windows-1251').text).toBe('Привет');
    expect(decodeBytes(utf8('Привет'), 'utf-8').text).toBe('Привет');
    expect(() => decodeBytes(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01]))).toThrow(ImportFileError);
  });
});

describe('разбор CSV', () => {
  it('разделитель определяется: ; , и табуляция', () => {
    expect(detectDelimiter('a;b;c\r\n1;2;3\r\n')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t');
    // запятая в десятичных числах не сбивает «;»
    expect(detectDelimiter('Цена;Название\n1250,50;Пила\n99,9;Нож\n')).toBe(';');
    expect(detectDelimiter('одна колонка\nзначение\n')).toBe(';');
  });

  it('кавычки, переносы строк в ячейке, удвоенные кавычки, CRLF и пустые строки в конце', () => {
    const r = parseCsv('a;b\r\n"x;1";"он сказал ""да""\r\nвторая строка"\r\n\r\n');
    expect(r.rows).toEqual([['a', 'b'], ['x;1', 'он сказал "да"\r\nвторая строка']]);
  });

  it('формулы остаются текстом', () => {
    const r = parseCsv('name;price\r\n=cmd|\' /C calc\'!A0;1\r\n+SUM(A1);2\r\n@x;3\r\n');
    expect(r.rows.map((x) => x[0])).toEqual(['name', "=cmd|' /C calc'!A0", '+SUM(A1)', '@x']);
  });

  it('незакрытая кавычка — повреждённый файл, ошибка с понятным текстом', () => {
    expect(() => parseCsv('a;b\n"не закрыта;1\n2;3\n')).toThrow(/кавычк/i);
  });

  it('лимит строк: 50 000 данных проходят, 50 001 — нет', () => {
    const body = (n: number) => 'sku\n' + Array.from({ length: n }, (_, i) => String(i)).join('\n');
    expect(parseCsv(body(MAX_IMPORT_ROWS)).rows).toHaveLength(MAX_IMPORT_ROWS + 1);
    expect(() => parseCsv(body(MAX_IMPORT_ROWS + 1))).toThrow(/50\s?000/);
  });
});

describe('формат по содержимому, а не по расширению', () => {
  it('YML распознаётся по разметке, CSV — по таблице; чужое отвергается', () => {
    expect(detectFormat('<?xml version="1.0"?><yml_catalog date="x"><shop/></yml_catalog>')).toBe('yml');
    expect(detectFormat('\n  <yml_catalog><shop></shop></yml_catalog>')).toBe('yml');
    expect(detectFormat('sku;name\n1;Пила')).toBe('csv');
    expect(() => detectFormat('<html><body>hi</body></html>')).toThrow(ImportFileError);
    expect(() => detectFormat('{"a":1}')).toThrow(ImportFileError);
    expect(() => detectFormat('   \n ')).toThrow(ImportFileError);
  });

  it('csv() помощник тестов согласован с разбором', () => {
    const text = csv([['a', 'b'], ['1;2', 'x"y']]);
    expect(parseCsv(text).rows).toEqual([['a', 'b'], ['1;2', 'x"y']]);
  });
});
