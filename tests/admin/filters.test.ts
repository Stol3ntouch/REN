import { describe, expect, it } from 'vitest';
import { attributeOps } from '@/app/admin/(panel)/_lib/attributes-ops';
import { filterOps } from '@/app/admin/(panel)/_lib/filters-ops';
import { audit } from '@/domain/admin/audit';
import type { FilterInput } from '@/domain/catalog/filters';
import type { Db } from '@/server/db/connection';
import { filtersRepo } from '@/server/db/repositories/filters';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { addCategory, addProduct, attributeId, createTestDb } from '../catalog/helpers';
import { admin, manager, T0 } from './helpers';

const opts = (db: Db) => ({ db, now: T0 });
const filter = (over: Record<string, unknown> = {}): FilterInput =>
  ({ kind: 'attribute', attributeId: null, label: 'Фильтр', widget: 'checkbox', sort: 0, enabled: true, config: {}, categoryIds: [], ...over }) as FilterInput;
const list = (db: Db, over = {}) => filterOps.list(admin, { limit: 500, offset: 0, ...over }, opts(db));
const newAttr = (db: Db, name: string, type = 'string', over: Record<string, unknown> = {}) =>
  attributeOps.create(admin, { name, code: '', type: type as 'string', unit: '', required: false, filterable: true, comparable: true, sort: 0, categoryIds: [], allowedValues: [], ...over }, opts(db)).id;
/** Удаляет автоматически созданный фильтр характеристики, чтобы создать его вручную. */
const dropAuto = (db: Db, attributeId: number) => filtersRepo.delete(db, filtersRepo.findByAttribute(db, attributeId)!.id);

describe('фильтры: сид и права', () => {
  it('сид воспроизводит прежнюю витрину: цена, наличие, бренд включены, подкатегории выключены', () => {
    const db = createTestDb();
    const rows = list(db).rows;
    expect(rows.map((f) => [f.kind, f.enabled])).toEqual([
      ['price', true],
      ['stock', true],
      ['brand', true],
      ['category', false],
    ]);
  });

  it('новая характеристика (импорт) сразу получает включённый фильтр по умолчанию с её названием', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    addProduct(db, { name: 'А', categoryId: cat, attrs: { Тип: 'Бензиновый' } });
    const f = filtersRepo.findByAttribute(db, Number(attributeId(db, 'Тип')))!;
    expect(f).toMatchObject({ kind: 'attribute', label: 'Тип', widget: 'checkbox', enabled: true, config: {} });
  });

  it('менеджер читает, но не пишет (403); без сессии 401; данные и аудит не меняются', () => {
    const db = createTestDb();
    const id = list(db).rows[0]!.id;
    expect(filterOps.list(manager, { limit: 5, offset: 0 }, opts(db)).total).toBe(4);
    expect(() => filterOps.setEnabled(manager, id, false, opts(db))).toThrow(ForbiddenError);
    expect(() => filterOps.remove(manager, id, opts(db))).toThrow(ForbiddenError);
    expect(() => filterOps.reorder(manager, [id], opts(db))).toThrow(ForbiddenError);
    expect(() => filterOps.create(null, filter({ kind: 'brand', label: 'Б' }), opts(db))).toThrow(UnauthorizedError);
    expect(filtersRepo.findById(db, id)!.enabled).toBe(true);
    expect(audit.list({ entity: 'filter' }, { db })).toEqual([]);
  });
});

describe('фильтры: проверка конфигурации', () => {
  it('фильтр характеристики без характеристики и фильтр другого вида с характеристикой отклоняются', () => {
    const db = createTestDb();
    const a = newAttr(db, 'Цвет');
    dropAuto(db, a);
    expect(() => filterOps.create(admin, filter({ kind: 'attribute', attributeId: null }), opts(db))).toThrow(/выберите характеристику/);
    expect(() => filterOps.create(admin, filter({ kind: 'brand', attributeId: a, widget: 'checkbox' }), opts(db))).toThrow(/только у фильтра вида/);
    expect(() => filterOps.create(admin, filter({ kind: 'attribute', attributeId: 9999 }), opts(db))).toThrow(ValidationError);
  });

  it('диапазон допустим только для цены и числовой характеристики', () => {
    const db = createTestDb();
    const str = newAttr(db, 'Цвет');
    const num = newAttr(db, 'Вес', 'number');
    dropAuto(db, str);
    dropAuto(db, num);
    expect(() => filterOps.create(admin, filter({ attributeId: str, widget: 'range' }), opts(db))).toThrow(/Диапазон/);
    expect(() => filterOps.update(admin, list(db, { kind: 'stock' }).rows[0]!.id, filter({ kind: 'stock', widget: 'range', label: 'Наличие' }), opts(db))).toThrow(/Диапазон/);
    const ok = filterOps.create(admin, filter({ attributeId: num, widget: 'range' }), opts(db));
    expect(filtersRepo.findById(db, ok.id)!.widget).toBe('range');
  });

  it('характеристика вне фильтров не годится; повтор фильтра характеристики и служебного вида — конфликт', () => {
    const db = createTestDb();
    const hidden = newAttr(db, 'Скрытая', 'string', { filterable: false });
    dropAuto(db, hidden);
    expect(() => filterOps.create(admin, filter({ attributeId: hidden }), opts(db))).toThrow(/не участвует в фильтрах/);
    const a = newAttr(db, 'Цвет');
    expect(() => filterOps.create(admin, filter({ attributeId: a }), opts(db))).toThrow(ConflictError);
    expect(() => filterOps.create(admin, filter({ kind: 'price', widget: 'range' }), opts(db))).toThrow(ConflictError);
  });

  it('пороги и названия проверяются', () => {
    const db = createTestDb();
    const a = newAttr(db, 'Цвет');
    dropAuto(db, a);
    expect(() => filterOps.create(admin, filter({ attributeId: a, config: { minProducts: 0 } }), opts(db))).toThrow(ValidationError);
    expect(() => filterOps.create(admin, filter({ attributeId: a, config: { maxValues: 9999 } }), opts(db))).toThrow(ValidationError);
    expect(() => filterOps.create(admin, filter({ attributeId: a, label: '   ' }), opts(db))).toThrow(ValidationError);
    expect(() => filterOps.create(admin, filter({ attributeId: a, categoryIds: [4242] }), opts(db))).toThrow(ValidationError);
  });
});

describe('фильтры: изменение, порядок, аудит', () => {
  it('смена вида (характеристика → бренд после снятия характеристики) и категории сохраняются; аудит filter.*', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const a = newAttr(db, 'Цвет');
    const f = filtersRepo.findByAttribute(db, a)!;
    filterOps.update(admin, f.id, filter({ attributeId: a, label: 'Цвет корпуса', categoryIds: [cat], config: { minProducts: 2 } }), opts(db));
    expect(filtersRepo.findById(db, f.id)).toMatchObject({ label: 'Цвет корпуса', categoryIds: [cat], config: { minProducts: 2 } });
    filterOps.setEnabled(admin, f.id, false, opts(db));
    expect(filtersRepo.findById(db, f.id)!.enabled).toBe(false);
    const actions = audit.list({ entity: 'filter' }, { db }).map((r) => r.action).sort();
    expect(actions).toEqual(['filter.toggle', 'filter.update']);
    filterOps.remove(admin, f.id, opts(db));
    expect(audit.list({ action: 'filter.delete' }, { db })).toHaveLength(1);
  });

  it('порядок: reorder расставляет 10, 20, 30…; список отдаётся по порядку', () => {
    const db = createTestDb();
    const [price, stock, brand] = list(db).rows.map((r) => r.id) as [number, number, number];
    filterOps.reorder(admin, [brand, price, stock], opts(db));
    expect(list(db).rows.slice(0, 3).map((r) => [r.id, r.sort])).toEqual([
      [brand, 10],
      [price, 20],
      [stock, 30],
    ]);
    expect(audit.list({ action: 'filter.reorder' }, { db })).toHaveLength(1);
  });

  it('снятие у характеристики признака «в фильтрах» убирает фильтр с витрины, а смена типа с числа сбрасывает диапазон', () => {
    const db = createTestDb();
    const num = newAttr(db, 'Вес', 'number');
    const f = filtersRepo.findByAttribute(db, num)!;
    filterOps.update(admin, f.id, filter({ attributeId: num, widget: 'range', label: 'Вес' }), opts(db));
    attributeOps.update(admin, num, { name: 'Вес', code: '', type: 'string', unit: '', required: false, filterable: true, comparable: true, sort: 0, categoryIds: [], allowedValues: [] }, opts(db));
    expect(filtersRepo.findByAttribute(db, num)!.widget).toBe('checkbox');
  });
});
