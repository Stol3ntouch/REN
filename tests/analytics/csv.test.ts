import { describe, expect, it } from 'vitest';
import { exportCsv, toCsv } from '@/domain/analytics';
import { createTestDb } from '@/server/db/testing';
import { ms, seedOctober } from './helpers';

describe('CSV', () => {
  it('начинается с BOM, разделитель «;», строки через CRLF', () => {
    const csv = toCsv(['a', 'b'], [['x', 1]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('a;b\r\nx;1\r\n');
  });

  it('текстовые ячейки с = + - @ получают апостроф (защита от формул); числа не трогаются', () => {
    const csv = toCsv(['name'], [['=1+1'], ['+7900'], ['-cmd'], ['@SUM(A1)'], [-5], ['\t=x'], ['обычный']]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines.slice(1, 8)).toEqual(["'=1+1", "'+7900", "'-cmd", "'@SUM(A1)", '-5', "'\t=x", 'обычный']);
  });

  it('ячейки с разделителем, кавычкой и переводом строки заключаются в кавычки', () => {
    const csv = toCsv(['t'], [['a;b'], ['say "hi"'], ['l1\nl2']]);
    expect(csv.slice(1)).toBe('t\r\n"a;b"\r\n"say ""hi"""\r\n"l1\nl2"\r\n');
  });

  it('экспорт категорий: деньги в рублях с запятой, формулы в названии экранированы', () => {
    const db = createTestDb();
    const { a } = seedOctober(db);
    db.prepare("UPDATE categories SET name = '=HYPERLINK(1)' WHERE id = (SELECT category_id FROM products WHERE id = ?)").run(a);
    const csv = exportCsv('categories', { from: ms('2026-10-01T00:00:00+03:00'), to: ms('2026-11-01T00:00:00+03:00') }, 'day', { db });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Категория;Штук;Выручка, ₽');
    expect(lines[1]).toBe("'=HYPERLINK(1);3;3000,00");
  });
});
