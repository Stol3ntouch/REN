import { describe, expect, it } from 'vitest';
import { attributeOps } from '@/app/admin/(panel)/_lib/attributes-ops';
import { audit } from '@/domain/admin/audit';
import { coerceValue, parseNumber, type AttributeInput } from '@/domain/catalog/attributes';
import type { Db } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { addCategory, addProduct, attributeId, createTestDb } from '../catalog/helpers';
import { admin, manager, T0 } from './helpers';

const opts = (db: Db) => ({ db, now: T0 });
const input = (over: Record<string, unknown> = {}): AttributeInput => ({
  name: 'Мощность',
  code: '',
  type: 'string',
  unit: '',
  required: false,
  filterable: true,
  comparable: true,
  sort: 0,
  categoryIds: [] as number[],
  allowedValues: [] as string[],
  ...over,
}) as AttributeInput;
const stored = (db: Db, name: string) =>
  db
    .prepare('SELECT pa.value AS value, pa.value_num AS num FROM product_attributes pa JOIN attribute_definitions d ON d.id = pa.attribute_id WHERE d.name = ? ORDER BY pa.id')
    .all(name) as { value: string; num: number | null }[];

describe('разбор значений по типам (строго)', () => {
  it('число принимает запятую и пробелы, но не единицы и диапазоны', () => {
    expect(parseNumber('3,2')).toBe(3.2);
    expect(parseNumber('1 200,5')).toBe(1200.5);
    expect(parseNumber('-5')).toBe(-5);
    for (const bad of ['3,2 кг', '2,5/3,4', '', 'abc', '1e5']) expect(parseNumber(bad), bad).toBeNull();
  });

  it('логическое — в 0/1 и «Да/Нет», дата — существующий день, список — только из допустимых', () => {
    expect(coerceValue('boolean', 'да')).toEqual({ ok: true, value: { text: 'Да', num: 1 } });
    expect(coerceValue('boolean', 'false')).toEqual({ ok: true, value: { text: 'Нет', num: 0 } });
    expect(coerceValue('boolean', 'возможно').ok).toBe(false);
    expect(coerceValue('date', '24.10.2026')).toEqual({ ok: true, value: { text: '2026-10-24', num: null } });
    expect(coerceValue('date', '2026-02-30').ok).toBe(false);
    expect(coerceValue('list', 'красный', ['Красный', 'Синий'])).toEqual({ ok: true, value: { text: 'Красный', num: null } });
    expect(coerceValue('list', 'зелёный', ['Красный']).ok).toBe(false);
    expect(coerceValue('number', '12').ok).toBe(true);
  });
});

describe('характеристики: права и CRUD', () => {
  it('менеджер читает, но не пишет; без сессии 401', () => {
    const db = createTestDb();
    expect(attributeOps.list(manager, { sort: 'name', dir: 'asc', limit: 5, offset: 0 }, opts(db)).total).toBe(0);
    expect(() => attributeOps.create(manager, input(), opts(db))).toThrow(ForbiddenError);
    expect(() => attributeOps.create(null, input(), opts(db))).toThrow(UnauthorizedError);
    expect(attributesRepo.countDefinitions(db)).toBe(0);
  });

  it('создаёт с кодом из названия, уникальность названия и кода, аудит attribute.*', () => {
    const db = createTestDb();
    const { id } = attributeOps.create(admin, input({ unit: 'кВт' }), opts(db));
    expect(attributesRepo.findById(db, id)).toMatchObject({ code: 'moshchnost', unit: 'кВт', type: 'string', filterable: true });
    expect(() => attributeOps.create(admin, input(), opts(db))).toThrow(ConflictError);
    expect(() => attributeOps.create(admin, input({ name: 'Другая', code: 'moshchnost' }), opts(db))).toThrow(ConflictError);
    expect(() => attributeOps.create(admin, input({ name: 'Т', code: '1 bad' }), opts(db))).toThrow(ValidationError);
    expect(audit.list({ action: 'attribute.create' }, { db })).toHaveLength(1);
  });

  it('список требует допустимых значений; допустимые значения — только у списка; единица не для даты', () => {
    const db = createTestDb();
    expect(() => attributeOps.create(admin, input({ type: 'list' }), opts(db))).toThrow(ValidationError);
    expect(() => attributeOps.create(admin, input({ allowedValues: ['а'] }), opts(db))).toThrow(ValidationError);
    expect(() => attributeOps.create(admin, input({ type: 'date', unit: 'дн' }), opts(db))).toThrow(ValidationError);
    const { id } = attributeOps.create(admin, input({ name: 'Цвет', type: 'list', allowedValues: ['Красный', 'Синий'] }), opts(db));
    expect(attributesRepo.findById(db, id)!.allowedValues).toEqual(['Красный', 'Синий']);
  });
});

describe('характеристики: данные существующего импорта не теряются', () => {
  it('значения остаются строками (тип string, value_num пуст) после создания определений импортом', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    addProduct(db, { name: 'Т', categoryId: cat, attrs: { 'Вес, (кг)': '3,2', Тип: ' Бензиновый' } });
    const a = attributesRepo.findById(db, Number(attributeId(db, 'Вес, (кг)')))!;
    expect(a.type).toBe('string');
    expect(a.code).toMatch(/^attr_\d+$/);
    expect(stored(db, 'Вес, (кг)')).toEqual([{ value: '3,2', num: null }]);
    expect(stored(db, 'Тип')).toEqual([{ value: ' Бензиновый', num: null }]);
  });

  it('смена типа на «Число» переводит значения, если все подходят', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    addProduct(db, { name: 'А', categoryId: cat, attrs: { Вес: '3,2' } });
    addProduct(db, { name: 'Б', categoryId: cat, attrs: { Вес: '10' } });
    const id = Number(attributeId(db, 'Вес'));
    expect(attributeOps.get(admin, id, opts(db))!.suggestedType).toBe('number');
    const r = attributeOps.update(admin, id, input({ name: 'Вес', code: 'ves', type: 'number', unit: 'кг' }), opts(db));
    expect(r.converted).toBe(2);
    expect(stored(db, 'Вес')).toEqual([
      { value: '3,2', num: 3.2 },
      { value: '10', num: 10 },
    ]);
  });

  it('смена типа отклоняется, если хоть одно значение не подходит: данные не меняются', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    addProduct(db, { name: 'А', categoryId: cat, attrs: { Вес: '3,2' } });
    addProduct(db, { name: 'Б', categoryId: cat, attrs: { Вес: 'около 10 кг' } });
    const id = Number(attributeId(db, 'Вес'));
    expect(() => attributeOps.update(admin, id, input({ name: 'Вес', code: 'ves', type: 'number' }), opts(db))).toThrow(/около 10 кг/);
    expect(attributesRepo.findById(db, id)!.type).toBe('string');
    expect(stored(db, 'Вес')).toEqual([
      { value: '3,2', num: null },
      { value: 'около 10 кг', num: null },
    ]);
  });

  it('импорт значения в числовую характеристику: подходящее нормализуется, неподходящее сохраняется как есть', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    addProduct(db, { name: 'А', categoryId: cat, attrs: { Вес: '3' } });
    const id = Number(attributeId(db, 'Вес'));
    attributeOps.update(admin, id, input({ name: 'Вес', code: 'ves', type: 'number' }), opts(db));
    addProduct(db, { name: 'Б', categoryId: cat, attrs: { Вес: '4,5' } });
    addProduct(db, { name: 'В', categoryId: cat, attrs: { Вес: 'не указан' } });
    expect(stored(db, 'Вес').map((r) => r.num)).toEqual([3, 4.5, null]);
    expect(stored(db, 'Вес').map((r) => r.value)).toEqual(['3', '4,5', 'не указан']);
  });
});

describe('характеристики: значения товара, объединение, удаление', () => {
  it('значение товара проверяется по типу на сервере и пишет аудит; обязательную нельзя очистить', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const p = addProduct(db, { name: 'А', categoryId: cat });
    const num = attributeOps.create(admin, input({ name: 'Мощность', type: 'number', required: true }), opts(db)).id;
    const flag = attributeOps.create(admin, input({ name: 'Стартер', type: 'boolean' }), opts(db)).id;
    expect(() => attributeOps.setProductValue(admin, p, num, 'много', opts(db))).toThrow(ValidationError);
    expect(attributeOps.setProductValue(admin, p, num, '2,5', opts(db))).toEqual({ text: '2,5' });
    expect(attributeOps.setProductValue(admin, p, flag, 'да', opts(db))).toEqual({ text: 'Да' });
    expect(() => attributeOps.setProductValue(admin, p, num, '', opts(db))).toThrow(ValidationError);
    expect(() => attributeOps.setProductValue(manager, p, num, '1', opts(db))).toThrow(ForbiddenError);
    expect(attributesRepo.valuesOfProduct(db, p)).toHaveLength(2);
    expect(audit.list({ action: 'attribute.value' }, { db })).toHaveLength(2);
  });

  it('объединение переносит значения и отбрасывает дубль у товара, где значение уже есть; типы должны совпадать', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const p1 = addProduct(db, { name: 'А', categoryId: cat, attrs: { 'Мощность': '2', 'Мощьность': '3' } });
    addProduct(db, { name: 'Б', categoryId: cat, attrs: { 'Мощьность': '5' } });
    const keep = Number(attributeId(db, 'Мощность'));
    const dup = Number(attributeId(db, 'Мощьность'));
    expect(() => attributeOps.merge(admin, dup, dup, opts(db))).toThrow(ValidationError);
    expect(() => attributeOps.merge(manager, dup, keep, opts(db))).toThrow(ForbiddenError);
    expect(attributeOps.merge(admin, dup, keep, opts(db))).toEqual({ moved: 1, dropped: 1 });
    expect(attributesRepo.findById(db, dup)).toBeUndefined();
    expect(stored(db, 'Мощность').map((r) => r.value)).toEqual(['2', '5']);
    expect(attributesRepo.valuesOfProduct(db, p1)).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM catalog_filters WHERE attribute_id = ?').get(dup)).toEqual({ n: 0 });
    const n = attributeOps.create(admin, input({ name: 'Число', type: 'number' }), opts(db)).id;
    expect(() => attributeOps.merge(admin, n, keep, opts(db))).toThrow(ValidationError);
    expect(audit.list({ action: 'attribute.merge' }, { db })).toHaveLength(1);
  });

  it('удаление: со значениями — только явно вместе с ними', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    addProduct(db, { name: 'А', categoryId: cat, attrs: { Цвет: 'Красный' } });
    const id = Number(attributeId(db, 'Цвет'));
    expect(() => attributeOps.remove(admin, id, opts(db))).toThrow(ConflictError);
    expect(attributeOps.remove(admin, id, { ...opts(db), withValues: true })).toEqual({ deletedValues: 1 });
    expect(attributesRepo.findById(db, id)).toBeUndefined();
    expect(audit.list({ action: 'attribute.delete' }, { db })).toHaveLength(1);
  });

  it('forCategory учитывает ограничение по категориям и предков', () => {
    const db = createTestDb();
    const root = addCategory(db, 'Корень', 'root');
    const sub = addCategory(db, 'Под', 'sub', root);
    const other = addCategory(db, 'Другая', 'other');
    attributeOps.create(admin, input({ name: 'Везде' }), opts(db));
    attributeOps.create(admin, input({ name: 'Только корень', categoryIds: [root] }), opts(db));
    const names = (c: number) => attributeOps.forCategory(admin, c, opts(db)).map((a) => a.name).sort();
    expect(names(sub)).toEqual(['Везде', 'Только корень']);
    expect(names(other)).toEqual(['Везде']);
  });
});
