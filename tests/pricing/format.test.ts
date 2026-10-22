import { describe, expect, it } from 'vitest';
import { formatRub, parseRubles } from '@/domain/pricing/format';

describe('parseRubles: ввод суммы в админке → копейки', () => {
  it('целые и дробные рубли, запятая и точка, пробелы', () => {
    expect(parseRubles('500')).toBe(50_000);
    expect(parseRubles(' 1 250,50 ')).toBe(125_050);
    expect(parseRubles('0.5')).toBe(50);
    expect(parseRubles('12.05')).toBe(1_205);
    expect(parseRubles('0')).toBe(0);
  });

  it('мусор, отрицательные и более двух знаков после запятой → null', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1,2,3', '1e3', '12 руб']) expect(parseRubles(bad), bad).toBeNull();
  });
});

describe('formatRub', () => {
  it('целые рубли без копеек, дробные — с двумя знаками; знак рубля через неразрывный пробел', () => {
    expect(formatRub(150_000).replace(/\s/g, ' ')).toBe('1 500 ₽');
    expect(formatRub(125_050).replace(/\s/g, ' ')).toBe('1 250,50 ₽');
    expect(formatRub(0).replace(/\s/g, ' ')).toBe('0 ₽');
  });
});
