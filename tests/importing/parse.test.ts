import { describe, expect, it } from 'vitest';
import { ImportFileError, parseYml } from '@/importing/yml/parse';
import { ymlXml } from './helpers';

describe('parseYml: нормальные данные', () => {
  it('читает категории (2 уровня) и товар: артикул=model, цена в копейках, наличие, характеристики', () => {
    const xml = ymlXml({
      offers: [
        {
          id: '35',
          name: 'Пила CHAMPION 125T-10&quot;',
          model: '125T-10',
          categoryId: '11',
          price: '18990.00000000',
          url: 'https://champion.ru/catalog/pily/champion-125t-10-quot/',
          available: 'false',
          description: 'Короткое<br>описание',
          pictures: ['https://champion.ru/a.jpg', 'https://champion.ru/b.jpg'],
          params: [
            ['Вес, (кг)', '3,2'],
            ['Тип', ' Бензиновая '],
          ],
        },
      ],
    });
    const r = parseYml(xml);
    expect(r.errors).toEqual([]);
    expect(r.categories).toEqual([
      { externalId: '10', parentExternalId: null, name: 'Генераторы', position: 0 },
      { externalId: '11', parentExternalId: '10', name: 'Бензиновые генераторы', position: 1 },
    ]);
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]).toMatchObject({
      externalId: '35',
      name: 'Пила CHAMPION 125T-10"',
      sku: '125T-10',
      categoryExternalId: '11',
      priceKopecks: 1899000,
      inStock: false,
      slugHint: 'champion-125t-10-quot',
      description: 'Короткое<br>описание',
      pictures: ['https://champion.ru/a.jpg', 'https://champion.ru/b.jpg'],
      attributes: [
        { name: 'Вес, (кг)', value: '3,2' },
        { name: 'Тип', value: 'Бензиновая' },
      ],
    });
  });

  it.each([
    ['18990.00000000', 1899000],
    ['7490', 749000],
    ['199.9', 19990],
    ['0.5', 50],
    ['1234567.89', 123456789],
  ])('цена «%s» → %i копеек', (price, kopecks) => {
    expect(parseYml(ymlXml({ offers: [{ id: '1', price }] })).offers[0]?.priceKopecks).toBe(kopecks);
  });

  it('артикул и числовые идентификаторы остаются строками (без потери ведущих нулей)', () => {
    const r = parseYml(ymlXml({ offers: [{ id: '007', model: '0012', categoryId: '10' }] }));
    expect(r.offers[0]).toMatchObject({ externalId: '007', sku: '0012' });
  });

  it('available не задан → в наличии; пустой model → артикула нет', () => {
    const xml = ymlXml({ offers: [`<offer id="5"><name>Т</name><model></model><categoryId>10</categoryId><price>10</price></offer>`] });
    expect(parseYml(xml).offers[0]).toMatchObject({ inStock: true, sku: null });
  });

  it('очищает HTML описания: теги из белого списка остаются, скрипты и атрибуты — нет', () => {
    const dirty = '<p onclick="x()">Текст <b>жирный</b></p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">ссылка</a><br>';
    const d = parseYml(ymlXml({ offers: [{ id: '1', description: dirty }] })).offers[0]?.description ?? '';
    expect(d).toContain('<p>Текст <b>жирный</b></p>');
    expect(d).toContain('<br>');
    expect(d).not.toMatch(/script|alert|onerror|onclick|javascript|<img|<a /i);
    expect(d).toContain('ссылка'); // текст ссылки сохраняется
  });

  it('пустые значения характеристик пропускаются', () => {
    const r = parseYml(ymlXml({ offers: [{ id: '1', params: [['Цвет', ''], ['Тип', 'А']] }] }));
    expect(r.offers[0]?.attributes).toEqual([{ name: 'Тип', value: 'А' }]);
  });
});

describe('parseYml: ошибки по строкам не останавливают разбор', () => {
  it('пустая/нечисловая/нулевая/отрицательная цена, нет названия, нет id, нет категории — в отчёт; остальные товары разобраны', () => {
    const xml = ymlXml({
      offers: [
        { id: '1' },
        { id: '2', price: '' },
        { id: '3', price: 'abc' },
        { id: '4', price: '0' },
        { id: '5', price: '-10' },
        { id: '6', name: '' },
        { id: '7', categoryId: '' },
        `<offer><name>Без id</name><categoryId>10</categoryId><price>5</price></offer>`,
        { id: '9', price: '5.00' },
      ],
    });
    const r = parseYml(xml);
    expect(r.offers.map((o) => o.externalId)).toEqual(['1', '9']);
    const errs = r.errors.filter((e) => e.kind === 'offer');
    expect(errs.map((e) => e.externalId)).toEqual(['2', '3', '4', '5', '6', '7', undefined]);
    expect(errs.every((e) => e.message.length > 5)).toBe(true);
    expect(errs[0]?.message).toMatch(/цен/i);
  });

  it('повторный id offer в файле: первый берётся, второй — в ошибки', () => {
    const r = parseYml(ymlXml({ offers: [{ id: '1', name: 'Первый' }, { id: '1', name: 'Второй' }] }));
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]?.name).toBe('Первый');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ kind: 'offer', externalId: '1' });
  });

  it('категория без id, с неизвестным родителем или в цикле — ошибка; корректные категории сохраняются', () => {
    const xml = ymlXml({
      categories: [
        `<category id="10">Ок</category>`,
        `<category>Без id</category>`,
        `<category id="12" parentId="999">Сирота</category>`,
        `<category id="13" parentId="14">Цикл А</category>`,
        `<category id="14" parentId="13">Цикл Б</category>`,
        `<category id="15" parentId="15">Сам себе родитель</category>`,
      ],
      offers: [],
    });
    const r = parseYml(xml);
    expect(r.categories.map((c) => c.externalId)).toEqual(['10']);
    expect(r.errors.filter((e) => e.kind === 'category')).toHaveLength(5);
  });

  it('ссылки на фото: только http(s); небезопасные и повторы отбрасываются, остальное остаётся', () => {
    const pics = ['https://champion.ru/a.jpg', 'javascript:alert(1)', 'file:///etc/passwd', 'data:image/png;base64,AAAA', '//champion.ru/x.jpg', 'http://champion.ru/c.jpg', 'https://champion.ru/a.jpg'];
    const r = parseYml(ymlXml({ offers: [{ id: '1', pictures: pics }] }));
    expect(r.offers[0]?.pictures).toEqual(['https://champion.ru/a.jpg', 'http://champion.ru/c.jpg']);
    expect(r.errors.filter((e) => e.kind === 'image')).toHaveLength(4);
  });

  it('больше 25 фото у товара: лишние отбрасываются с предупреждением', () => {
    const pics = Array.from({ length: 30 }, (_, i) => `https://champion.ru/p${i}.jpg`);
    const r = parseYml(ymlXml({ offers: [{ id: '1', pictures: pics }] }));
    expect(r.offers[0]?.pictures).toHaveLength(25);
    expect(r.errors.some((e) => e.kind === 'image' && e.externalId === '1')).toBe(true);
  });
});

describe('parseYml: отклонение файла', () => {
  it.each([
    ['пустой', ''],
    ['обычный текст', 'это не xml'],
    ['HTML-страница', '<!DOCTYPE html><html><body>Привет</body></html>'],
    ['битый XML', '<yml_catalog><shop><offers><offer id="1"></shop></yml_catalog>'],
    ['XML другого формата', '<?xml version="1.0"?><root><item/></root>'],
    ['JSON', '{"offers": []}'],
  ])('%s → ImportFileError', (_n, text) => {
    expect(() => parseYml(text)).toThrow(ImportFileError);
  });

  it('файл больше 20 МБ отклоняется до разбора', () => {
    const big = ymlXml() + ' '.repeat(20 * 1024 * 1024);
    expect(() => parseYml(big)).toThrow(/20 МБ/);
    expect(() => parseYml(big)).toThrow(ImportFileError);
  });

  it('файл без offers и категорий — не ошибка файла, пустой результат', () => {
    const r = parseYml(ymlXml({ categories: [], offers: [] }));
    expect(r).toEqual({ categories: [], offers: [], errors: [] });
  });
});
