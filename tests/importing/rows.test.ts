import { describe, expect, it } from 'vitest';
import { autoMap, validateMapping } from '@/importing/fields';
import { parseRows } from '@/importing/rows';

describe('автоподбор сопоставления', () => {
  it('русские и английские заголовки, регистр и знаки не важны; attr:<код> и название характеристики', () => {
    const headers = ['Артикул', 'НАИМЕНОВАНИЕ', 'Цена, ₽', 'остатки', 'Категория', 'Производитель', 'Штрих-код', 'attr:power', 'Вес', 'Левая колонка'];
    const m = autoMap(headers, [
      { code: 'power', name: 'Мощность' },
      { code: 'weight', name: 'Вес' },
    ]);
    expect(m).toMatchObject({ Артикул: 'sku', НАИМЕНОВАНИЕ: 'name', 'Цена, ₽': 'price', остатки: 'stock', Категория: 'category', Производитель: 'brand', 'Штрих-код': 'barcode', 'attr:power': 'attr:power', Вес: 'attr:weight', 'Левая колонка': '' });
  });

  it('одно поле — одна колонка; проверка находит двойное сопоставление и неизвестное поле', () => {
    const m = autoMap(['sku', 'Артикул'], []);
    expect(Object.values(m).filter((v) => v === 'sku')).toHaveLength(1);
    expect(validateMapping(['a', 'b'], { a: 'sku', b: 'sku' })).toHaveLength(1);
    expect(validateMapping(['a'], { a: 'bogus' })[0]).toMatch(/неизвестное поле/);
    expect(validateMapping(['a'], { a: 'attr:zzz' }, new Set(['power']))[0]).toMatch(/не найдена/);
    expect(validateMapping(['a', 'b'], { a: 'sku', b: '' })).toEqual([]);
  });
});

describe('разбор строк', () => {
  const headers = ['sku', 'name', 'price', 'old', 'qty', 'pub', 'img', 'barcode', 'slug', 'x'];
  const mapping = { sku: 'sku', name: 'name', price: 'price', old: 'oldPrice', qty: 'stock', pub: 'published', img: 'images', barcode: 'barcode', slug: 'slug', x: 'attr:power' };

  it('цены в копейках, остаток целый, «да/нет», ссылки через |, характеристики, пустые ячейки', () => {
    const [r] = parseRows(headers, [['A-1', 'Пила', '1 250,50', '1500', '12', 'да', 'https://a.test/1.jpg | https://a.test/2.jpg', '4601234567890', 'pila-1', '2000']], mapping);
    expect(r!.rowNo).toBe(2);
    expect(r!.issues).toEqual([]);
    expect(r!.values).toMatchObject({ sku: 'A-1', name: 'Пила', priceKopecks: 125050, oldPriceKopecks: 150000, stockQty: 12, published: true, barcode: '4601234567890', slug: 'pila-1' });
    expect(r!.values.images).toEqual(['https://a.test/1.jpg', 'https://a.test/2.jpg']);
    expect(r!.attrs).toEqual({ power: '2000' });
    const [e] = parseRows(headers, [['A-2', 'Нож', '10', '', '', '', '', '', '', '']], mapping);
    expect(e!.empty.sort()).toEqual(['attr:power', 'barcode', 'images', 'oldPrice', 'published', 'slug', 'stock']);
  });

  it('ошибки типов привязаны к строке и полю; номера строк — как в файле (заголовок = 1)', () => {
    const rows = parseRows(
      headers,
      [
        ['A-1', 'ok', '10', '', '', '', '', '', '', ''],
        ['A-2', 'x', 'abc', '', '-3', 'может', 'ftp://x', '12', 'Bad Slug', ''],
      ],
      mapping,
    );
    expect(rows[0]!.issues).toEqual([]);
    expect(rows[1]!.issues.map((i) => [i.row, i.field])).toEqual([
      [3, 'price'],
      [3, 'stock'],
      [3, 'published'],
      [3, 'images'],
      [3, 'barcode'],
      [3, 'slug'],
    ]);
  });

  it('формулы хранятся текстом; экранирующий апостроф выгрузки снимается', () => {
    const [r] = parseRows(['name', 'sku'], [["=cmd|' /C calc'!A0", "'=1+1"]], { name: 'name', sku: 'sku' });
    expect(r!.values.name).toBe("=cmd|' /C calc'!A0");
    expect(r!.values.sku).toBe('=1+1');
  });

  it('повтор заголовка: берётся первая колонка', () => {
    const [r] = parseRows(['sku', 'sku'], [['A', 'B']], { sku: 'sku' });
    expect(r!.values.sku).toBe('A');
  });
});
