import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { categorySeoOps } from '@/app/admin/(panel)/catalog/category-seo-ops';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/http/errors';
import { createTestDb } from '@/server/db/testing';
import { ymlXml } from '../importing/helpers';
import { admin, importXml, manager, T0 } from './helpers';

async function setup() {
  const db = createTestDb();
  await importXml(db, ymlXml({ offers: [{ id: '1' }] }));
  const root = categoriesRepo.findByExternalId(db, 'yml', '10')!;
  const child = categoriesRepo.findByExternalId(db, 'yml', '11')!;
  return { db, root, child };
}

const FULL = { seoTitle: 'Генераторы — купить', seoDescription: 'Описание для поиска', h1: 'Генераторы для дачи', seoText: 'Первый абзац.\n\nВторой абзац.' };

describe('SEO категорий в админке', () => {
  it('список — дерево с признаком «SEO-текст заполнен»; доступен менеджеру (только чтение)', async () => {
    const { db, root, child } = await setup();
    categorySeoOps.update(admin, child.id, FULL, { db, now: T0 });
    const rows = categorySeoOps.list(manager, { db });
    expect(rows.map((r) => [r.id, r.depth, r.hasSeoText])).toEqual([
      [root.id, 0, false],
      [child.id, 1, true],
    ]);
  });

  it('админ сохраняет title/description/H1/SEO-текст независимо от флага catalog.manualEdit (по умолчанию выключен)', async () => {
    const { db, child } = await setup();
    categorySeoOps.update(admin, child.id, FULL, { db, now: T0 });
    expect(categoriesRepo.findBySlug(db, child.slug)).toMatchObject(FULL);
  });

  it('менеджер получает отказ на сохранение, данные не меняются, аудита нет', async () => {
    const { db, child } = await setup();
    expect(() => categorySeoOps.update(manager, child.id, FULL, { db, now: T0 })).toThrow(ForbiddenError);
    expect(() => categorySeoOps.update(null, child.id, FULL, { db, now: T0 })).toThrow();
    expect(categoriesRepo.findBySlug(db, child.slug)).toMatchObject({ seoTitle: null, seoText: null });
    expect(audit.list({ entity: 'category' }, { db })).toEqual([]);
  });

  it('аудит: до/после только по изменённым SEO-полям, без ПДн; повтор без изменений аудит не пишет', async () => {
    const { db, child } = await setup();
    categorySeoOps.update(admin, child.id, FULL, { db, now: T0 });
    const [rec] = audit.list({ entity: 'category', entityId: String(child.id) }, { db });
    expect(rec).toMatchObject({ action: 'category.seo', actorId: '1', actorType: 'staff' });
    expect(rec!.before).toEqual({ seoTitle: null, seoDescription: null, h1: null, seoText: null });
    expect(rec!.after).toEqual(FULL);
    categorySeoOps.update(admin, child.id, FULL, { db, now: T0 });
    expect(audit.list({ entity: 'category' }, { db })).toHaveLength(1);
  });

  it('пустое значение очищает поле', async () => {
    const { db, child } = await setup();
    categorySeoOps.update(admin, child.id, FULL, { db, now: T0 });
    categorySeoOps.update(admin, child.id, { ...FULL, h1: '  ', seoText: '' }, { db, now: T0 });
    expect(categoriesRepo.findBySlug(db, child.slug)).toMatchObject({ h1: null, seoText: null, seoTitle: FULL.seoTitle });
  });

  it('валидация zod: SEO-текст не длиннее 5000 символов, title — 200, неизвестные поля отвергаются; 404 для чужого id', async () => {
    const { db, child } = await setup();
    expect(() => categorySeoOps.update(admin, child.id, { ...FULL, seoText: 'а'.repeat(5001) }, { db })).toThrow(ValidationError);
    categorySeoOps.update(admin, child.id, { ...FULL, seoText: 'а'.repeat(5000) }, { db, now: T0 });
    expect(() => categorySeoOps.update(admin, child.id, { ...FULL, seoTitle: 'а'.repeat(201) }, { db })).toThrow(ValidationError);
    expect(() => categorySeoOps.update(admin, child.id, { ...FULL, slug: 'x' }, { db })).toThrow(ValidationError);
    expect(() => categorySeoOps.update(admin, 9999, FULL, { db })).toThrow(NotFoundError);
  });

  it('повторный импорт YML после правки не затирает SEO-поля категории', async () => {
    const { db, child } = await setup();
    categorySeoOps.update(admin, child.id, FULL, { db, now: T0 });
    await importXml(db, ymlXml({ categories: [`<category id="10">Генераторы</category>`, `<category id="11" parentId="10">Переименованная</category>`], offers: [{ id: '1' }] }));
    expect(categoriesRepo.findByExternalId(db, 'yml', '11')).toMatchObject({ name: 'Переименованная', ...FULL });
  });
});
