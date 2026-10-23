import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { catalogOps } from '@/app/admin/(panel)/_lib/catalog-ops';
import { ForbiddenError, ValidationError } from '@/server/http/errors';
import { createTestDb } from '@/server/db/testing';
import { ymlXml } from '../importing/helpers';
import { admin, importXml, manager, productByExternal, setManualEdit, T0 } from './helpers';

const FIRST = ymlXml({ offers: [{ id: '1', name: 'Генератор', price: '1000.00', description: '<p>Из файла</p>' }] });

async function setup() {
  const db = createTestDb();
  await importXml(db, FIRST);
  return { db, id: productByExternal(db, '1').id };
}

describe('каталог: ручная правка за флагом catalog.manualEdit', () => {
  it('по умолчанию выключено: запись отвергается на сервере, данные не меняются, аудита нет', async () => {
    const { db, id } = await setup();
    expect(catalogOps.isManualEditEnabled(db)).toBe(false);
    expect(() => catalogOps.update(admin, id, { priceKopecks: 5000 }, { db, now: T0 })).toThrow(ForbiddenError);
    expect(productByExternal(db, '1').priceKopecks).toBe(100_000);
    expect(audit.list({ entity: 'product' }, { db })).toEqual([]);
  });

  it('включено, но менеджер: только просмотр — запись отвергается, чтение работает', async () => {
    const { db, id } = await setup();
    setManualEdit(db, true);
    expect(() => catalogOps.update(manager, id, { priceKopecks: 5000 }, { db, now: T0 })).toThrow(ForbiddenError);
    expect(catalogOps.get(manager, id, { db })?.product.name).toBe('Генератор');
    expect(catalogOps.list(manager, {}, { db }).total).toBe(1);
  });

  it('включено: админ правит цену, скидку, публикацию, featured, описание и SEO; поля закрепляются, правка аудируется', async () => {
    const { db, id } = await setup();
    setManualEdit(db, true);
    const res = catalogOps.update(
      admin,
      id,
      { priceKopecks: 90_000, discountPriceKopecks: 80_000, published: false, featured: true, description: '<p>Новое</p><script>x()</script>', seoTitle: 'Заголовок', seoDescription: 'Описание для поиска' },
      { db, now: T0 },
    );
    expect(res.changed.sort()).toEqual(['description', 'discount_price', 'featured', 'price', 'published', 'seo_description', 'seo_title']);
    const p = productByExternal(db, '1');
    expect(p).toMatchObject({ priceKopecks: 90_000, discountPriceKopecks: 80_000, published: false, featured: true });
    expect(p.description).toBe('<p>Новое</p>'); // скрипт вычищен
    expect(new Set(p.lockedFields)).toEqual(new Set(['price', 'description', 'discount_price', 'published', 'featured', 'seo_title', 'seo_description']));
    expect(catalogOps.get(admin, id, { db })?.product).toMatchObject({ seoTitle: 'Заголовок', seoDescription: 'Описание для поиска' });

    const [rec] = audit.list({ entity: 'product', entityId: String(id) }, { db });
    expect(rec).toMatchObject({ action: 'price.change', actorId: '1', actorType: 'staff' });
    expect(rec!.before).toMatchObject({ price: 100_000 });
    expect(rec!.after).toMatchObject({ price: 90_000, discount_price: 80_000, published: false });
  });

  it('повторная правка тем же значением ничего не меняет и не пишет аудит', async () => {
    const { db, id } = await setup();
    setManualEdit(db, true);
    catalogOps.update(admin, id, { priceKopecks: 90_000 }, { db, now: T0 });
    const before = audit.list({ entity: 'product' }, { db }).length;
    expect(catalogOps.update(admin, id, { priceKopecks: 90_000 }, { db, now: T0 }).changed).toEqual([]);
    expect(audit.list({ entity: 'product' }, { db }).length).toBe(before);
  });

  it('скидочная цена не ниже розничной и отрицательная цена отвергаются', async () => {
    const { db, id } = await setup();
    setManualEdit(db, true);
    expect(() => catalogOps.update(admin, id, { discountPriceKopecks: 100_000 }, { db, now: T0 })).toThrow(ValidationError);
    expect(() => catalogOps.update(admin, id, { priceKopecks: -1 }, { db, now: T0 })).toThrow(ValidationError);
    expect(productByExternal(db, '1').discountPriceKopecks).toBeNull();
  });

  it('импорт поверх ручной правки не перезаписывает закреплённые поля, а остальные обновляет', async () => {
    const { db, id } = await setup();
    setManualEdit(db, true);
    catalogOps.update(admin, id, { priceKopecks: 90_000, description: '<p>Моё описание</p>' }, { db, now: T0 });
    await importXml(db, ymlXml({ offers: [{ id: '1', name: 'Генератор 2.0', price: '1500.00', description: '<p>Опять из файла</p>' }] }));
    const p = productByExternal(db, '1');
    expect(p.priceKopecks).toBe(90_000);
    expect(p.description).toBe('<p>Моё описание</p>');
    expect(p.name).toBe('Генератор 2.0');
  });

  it('снятие закрепления возвращает поле под управление импорта', async () => {
    const { db, id } = await setup();
    setManualEdit(db, true);
    catalogOps.update(admin, id, { priceKopecks: 90_000 }, { db, now: T0 });
    catalogOps.unlock(admin, id, ['price'], { db, now: T0 });
    await importXml(db, ymlXml({ offers: [{ id: '1', name: 'Генератор', price: '1500.00' }] }));
    expect(productByExternal(db, '1').priceKopecks).toBe(150_000);
  });
});

describe('каталог: список', () => {
  it('поиск по названию и артикулу, фильтр по публикации', async () => {
    const db = createTestDb();
    await importXml(db, ymlXml({ offers: [{ id: '1', name: 'Бензопила Альфа', model: 'AL-1' }, { id: '2', name: 'Триммер Бета', model: 'BT-2' }] }));
    setManualEdit(db, true);
    expect(catalogOps.list(admin, { q: 'альфа' }, { db }).rows.map((r) => r.name)).toEqual(['Бензопила Альфа']);
    expect(catalogOps.list(admin, { q: 'bt-2' }, { db }).rows.map((r) => r.name)).toEqual(['Триммер Бета']);
    catalogOps.update(admin, productByExternal(db, '2').id, { published: false }, { db, now: T0 });
    expect(catalogOps.list(admin, { published: false }, { db }).rows.map((r) => r.name)).toEqual(['Триммер Бета']);
    expect(catalogOps.list(admin, { q: '100%' }, { db }).total).toBe(0); // спецсимволы LIKE не работают как шаблон
  });
});
