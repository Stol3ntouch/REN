import { describe, expect, it } from 'vitest';
import { brandOps } from '@/app/admin/(panel)/_lib/brands-ops';
import { audit } from '@/domain/admin/audit';
import type { Db } from '@/server/db/connection';
import { brandsRepo } from '@/server/db/repositories/brands';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';
import { admin, manager, T0 } from './helpers';

const opts = (db: Db) => ({ db, now: T0 });
const form = (over: Record<string, unknown> = {}) => ({ name: 'Champion', slug: '', description: '', siteUrl: '', published: true, sort: 0, seoTitle: '', seoDescription: '', ...over });
const brandOf = (db: Db, productId: number) => brandsRepo.getProductBrandId(db, productId);
const list = (db: Db, over = {}) => brandOps.list(admin, { sort: 'name', dir: 'asc', limit: 50, offset: 0, ...over }, opts(db));

describe('бренды: права', () => {
  it('менеджер видит список, но не пишет (403); без сессии — 401; данные не меняются', async () => {
    const db = createTestDb();
    expect(list(db).total).toBe(0);
    expect(brandOps.list(manager, { sort: 'name', dir: 'asc', limit: 5, offset: 0 }, opts(db)).total).toBe(0);
    await expect(brandOps.create(manager, form(), undefined, opts(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(brandOps.create(null, form(), undefined, opts(db))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(() => brandOps.list(null, { sort: 'name', dir: 'asc', limit: 5, offset: 0 }, opts(db))).toThrow(UnauthorizedError);
    expect(list(db).total).toBe(0);
    expect(audit.list({ entity: 'brand' }, { db })).toEqual([]);
  });
});

describe('бренды: создание и правка', () => {
  it('создаёт бренд, slug строится из названия, пишет аудит brand.create', async () => {
    const db = createTestDb();
    const { id } = await brandOps.create(admin, form({ name: 'Садовый Мастер', siteUrl: 'https://example.com' }), undefined, opts(db));
    const b = brandsRepo.findById(db, id)!;
    expect(b.slug).toBe('sadovyy-master');
    expect(b.source).toBe('manual');
    expect(audit.list({ entity: 'brand', action: 'brand.create' }, { db })).toHaveLength(1);
  });

  it('slug уникален; название без учёта регистра; URL только http(s)', async () => {
    const db = createTestDb();
    await brandOps.create(admin, form({ slug: 'champion' }), undefined, opts(db));
    await expect(brandOps.create(admin, form({ name: 'Другой', slug: 'champion' }), undefined, opts(db))).rejects.toBeInstanceOf(ConflictError);
    await expect(brandOps.create(admin, form({ name: 'CHAMPION', slug: 'x' }), undefined, opts(db))).rejects.toBeInstanceOf(ValidationError);
    for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'example.com', 'data:text/html,x']) {
      await expect(brandOps.create(admin, form({ name: `B ${bad}`, siteUrl: bad }), undefined, opts(db)), bad).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(brandOps.create(admin, form({ name: 'Slug', slug: 'Bad Slug!' }), undefined, opts(db))).rejects.toBeInstanceOf(ValidationError);
    expect(list(db).total).toBe(1);
  });

  it('правка пишет в аудит только изменённые поля; повтор без изменений аудит не пишет', async () => {
    const db = createTestDb();
    const { id } = await brandOps.create(admin, form(), undefined, opts(db));
    const r = await brandOps.update(admin, id, form({ description: 'Описание', sort: 5 }), undefined, opts(db));
    expect(r.changed.sort()).toEqual(['description', 'sort']);
    const rows = audit.list({ entity: 'brand', action: 'brand.update' }, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toEqual({ description: 'Описание', sort: 5 });
    await brandOps.update(admin, id, form({ description: 'Описание', sort: 5 }), undefined, opts(db));
    expect(audit.list({ entity: 'brand', action: 'brand.update' }, { db })).toHaveLength(1);
  });

  it('логотип проверяется по содержимому: не-картинка отклоняется, бренд не создаётся', async () => {
    const db = createTestDb();
    const fake = new TextEncoder().encode('<html>не картинка</html>');
    await expect(brandOps.create(admin, form(), { bytes: fake }, opts(db))).rejects.toBeInstanceOf(ValidationError);
    await expect(brandOps.create(admin, form(), { bytes: new Uint8Array(3 * 1024 * 1024) }, opts(db))).rejects.toBeInstanceOf(ValidationError);
    expect(list(db).total).toBe(0);
  });
});

describe('бренды: список, архив, удаление', () => {
  it('поиск, сортировка, серверная пагинация и фильтр архива', async () => {
    const db = createTestDb();
    for (const [i, name] of ['Бета', 'Альфа', 'Гамма', 'Дельта'].entries()) await brandOps.create(admin, form({ name, sort: 10 - i }), undefined, opts(db));
    expect(list(db, { sort: 'name' }).rows.map((b) => b.name)).toEqual(['Альфа', 'Бета', 'Гамма', 'Дельта']);
    expect(list(db, { sort: 'sort' }).rows.map((b) => b.name)).toEqual(['Дельта', 'Гамма', 'Альфа', 'Бета']);
    expect(list(db, { sort: 'name', limit: 2, offset: 2 })).toMatchObject({ total: 4, rows: [{ name: 'Гамма' }, { name: 'Дельта' }] });
    expect(list(db, { q: 'ГАММ' }).rows.map((b) => b.name)).toEqual(['Гамма']);
    const beta = brandsRepo.findByName(db, 'Бета')!;
    brandOps.setArchived(admin, beta.id, true, opts(db));
    expect(list(db).total).toBe(3);
    expect(list(db, { status: 'archived' }).rows.map((b) => b.name)).toEqual(['Бета']);
    expect(list(db, { status: 'all' }).total).toBe(4);
    expect(audit.list({ action: 'brand.archive' }, { db })).toHaveLength(1);
  });

  it('удаление запрещено при привязанных товарах; перенос в другой бренд разрешает удалить', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    const a = (await brandOps.create(admin, form({ name: 'А' }), undefined, opts(db))).id;
    const b = (await brandOps.create(admin, form({ name: 'Б' }), undefined, opts(db))).id;
    const p1 = addProduct(db, { name: 'Т1', categoryId: cat });
    const p2 = addProduct(db, { name: 'Т2', categoryId: cat });
    expect(brandOps.attachProducts(admin, a, [p1, p2], opts(db))).toBe(2);
    expect(brandOps.get(admin, a, opts(db))!.productCount).toBe(2);

    expect(() => brandOps.remove(admin, a, opts(db))).toThrow(ConflictError);
    expect(() => brandOps.remove(manager, a, opts(db))).toThrow(ForbiddenError);
    expect(brandsRepo.findById(db, a)).toBeDefined();
    expect(brandOf(db, p1)).toBe(a);

    expect(() => brandOps.remove(admin, a, { ...opts(db), moveToId: a })).toThrow(ValidationError);
    expect(brandOps.remove(admin, a, { ...opts(db), moveToId: b }).moved).toBe(2);
    expect(brandsRepo.findById(db, a)).toBeUndefined();
    expect(brandOf(db, p1)).toBe(b);
    expect(audit.list({ action: 'brand.delete' }, { db })).toHaveLength(1);
  });

  it('бренд без товаров удаляется сразу; отвязка не трогает чужие товары', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const a = (await brandOps.create(admin, form({ name: 'А' }), undefined, opts(db))).id;
    const b = (await brandOps.create(admin, form({ name: 'Б' }), undefined, opts(db))).id;
    const pa = addProduct(db, { name: 'ПА', categoryId: cat });
    const pb = addProduct(db, { name: 'ПБ', categoryId: cat });
    brandOps.attachProducts(admin, a, [pa], opts(db));
    brandOps.attachProducts(admin, b, [pb], opts(db));
    expect(brandOps.detachProducts(admin, a, [pa, pb], opts(db))).toBe(1);
    expect(brandOf(db, pa)).toBeNull();
    expect(brandOf(db, pb)).toBe(b);
    brandOps.remove(admin, a, opts(db));
    expect(brandsRepo.findById(db, a)).toBeUndefined();
  });
});
