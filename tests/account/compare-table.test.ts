import { describe, expect, it } from 'vitest';
import { compare } from '@/domain/customers/compare';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { GUEST_A, T0, addProduct, setupDb } from '../ordering/helpers';

describe('таблица сравнения', () => {
  it('объединяет ключи характеристик, отсутствующее — null, различия помечены', () => {
    const db = setupDb();
    const a = addProduct(db, { name: 'Триммер А', price: 500_000 });
    const b = addProduct(db, { name: 'Триммер Б', price: 700_000 });
    attributesRepo.replaceForProduct(db, a, [
      { name: 'Мощность', value: '1200 Вт' },
      { name: 'Вес', value: '4 кг' },
      { name: 'Гарантия', value: '2 года' },
    ]);
    attributesRepo.replaceForProduct(db, b, [
      { name: 'Мощность', value: '1500 Вт' },
      { name: 'Вес', value: ' 4 КГ ' },
      { name: 'Тип двигателя', value: 'бензиновый' },
    ]);
    compare.add(GUEST_A, a, { db, now: T0 });
    compare.add(GUEST_A, b, { db, now: T0 + 1 });

    const t = compare.table(GUEST_A, { db });
    expect(t.products.map((p) => p.name)).toEqual(['Триммер А', 'Триммер Б']);
    expect(t.rows.map((r) => r.name)).toEqual(['Мощность', 'Вес', 'Гарантия', 'Тип двигателя']);
    const by = Object.fromEntries(t.rows.map((r) => [r.name, r]));
    expect(by['Мощность']).toMatchObject({ values: ['1200 Вт', '1500 Вт'], differs: true });
    // регистр и пробелы — не различие
    expect(by['Вес']!.differs).toBe(false);
    // характеристика есть только у одного — это различие, у другого пусто
    expect(by['Гарантия']).toMatchObject({ values: ['2 года', null], differs: true });
    expect(by['Тип двигателя']).toMatchObject({ values: [null, 'бензиновый'], differs: true });
  });

  it('пустое сравнение: нет товаров и строк', () => {
    const db = setupDb();
    expect(compare.table(GUEST_A, { db })).toEqual({ products: [], rows: [] });
    expect(compare.table(null, { db })).toEqual({ products: [], rows: [] });
  });
});
