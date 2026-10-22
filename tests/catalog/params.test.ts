import { describe, expect, it } from 'vitest';
import { formatPrice, pluralize } from '@/domain/catalog/format';
import { buildCatalogQueryString, parseCatalogParams } from '@/domain/catalog/params';

describe('parseCatalogParams', () => {
  it('разбирает строку запроса: текст, сортировку, страницу, цену в рублях → копейки, наличие, характеристики', () => {
    const sp = new URLSearchParams('q=ht625r&sort=price_asc&page=3&min=100&max=5000&stock=1&a12=Бензиновый&a12=Электрический');
    expect(parseCatalogParams(sp, { categorySlug: 'trimmery' })).toEqual({
      categorySlug: 'trimmery',
      text: 'ht625r',
      sort: 'price_asc',
      page: 3,
      priceMin: 10000,
      priceMax: 500000,
      inStockOnly: true,
      filters: { '12': ['Бензиновый', 'Электрический'] },
    });
  });

  it('мусор в параметрах безвреден: страница ≥1, неизвестная сортировка и ключи игнорируются, текст ≤100 символов', () => {
    const q = parseCatalogParams({ page: '-5', sort: 'drop table', min: 'abc', max: '-3', stock: '0', aXYZ: 'x', 'a1;': 'y', q: 'я'.repeat(300) });
    expect(q.page).toBe(1);
    expect(q.sort).toBe('relevance');
    expect(q.priceMin).toBeUndefined();
    expect(q.priceMax).toBeUndefined();
    expect(q.inStockOnly).toBeUndefined();
    expect(q.filters).toEqual({});
    expect(q.text?.length).toBe(100);
    expect(parseCatalogParams({ page: 'abc' }).page).toBe(1);
    expect(parseCatalogParams({ page: '999999' }).page).toBe(1000);
  });

  it('сортировка по умолчанию: без текста — по названию, с текстом — по релевантности', () => {
    expect(parseCatalogParams({}).sort).toBe('name');
    expect(parseCatalogParams({ q: 'abc' }).sort).toBe('relevance');
    expect(parseCatalogParams({ q: 'abc', sort: 'name' }).sort).toBe('name');
    expect(parseCatalogParams({ sort: 'relevance' }).sort).toBe('name');
  });
});

describe('buildCatalogQueryString', () => {
  it('значения по умолчанию опускаются; разбор строки возвращает исходный запрос', () => {
    expect(buildCatalogQueryString({ filters: {}, sort: 'name', page: 1 })).toBe('');
    const q = parseCatalogParams(new URLSearchParams('q=sk 10&sort=popular&page=2&min=1&max=2&stock=1&a7=a&a7=b'));
    const again = parseCatalogParams(new URLSearchParams(buildCatalogQueryString(q)));
    expect(again).toEqual(q);
  });

  it('переопределения меняют запрос; смена фильтра сбрасывает страницу', () => {
    const q = parseCatalogParams({ page: '4', sort: 'price_desc' });
    expect(buildCatalogQueryString(q, { page: 5 })).toBe('sort=price_desc&page=5');
    expect(buildCatalogQueryString(q, { sort: 'name', page: 1 })).toBe('');
  });
});

describe('pluralize', () => {
  it('склоняет «товар» по правилам русского языка', () => {
    const f = (n: number) => pluralize(n, ['товар', 'товара', 'товаров']);
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map(f)).toEqual([
      'товаров', 'товар', 'товара', 'товара', 'товаров', 'товаров', 'товаров', 'товаров', 'товар', 'товара', 'товаров', 'товар', 'товаров', 'товаров',
    ]);
  });
});

describe('formatPrice', () => {
  it('копейки → «32 990 ₽» с неразрывными пробелами; копейки показываются только если они есть', () => {
    expect(formatPrice(3299000)).toBe('32 990 ₽');
    expect(formatPrice(99900)).toBe('999 ₽');
    expect(formatPrice(1050)).toBe('10,50 ₽');
    expect(formatPrice(0)).toBe('0 ₽');
    expect(formatPrice(123456789)).toBe('1 234 567,89 ₽');
  });
});
