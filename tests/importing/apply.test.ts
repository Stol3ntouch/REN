import { describe, expect, it } from 'vitest';
import { applyImport } from '@/importing/yml/apply';
import { parseYml } from '@/importing/yml/parse';
import { planImport } from '@/importing/yml/plan';
import { ImageFetchError } from '@/media/safe-fetch';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { importRunsRepo } from '@/server/db/repositories/import-runs';
import { imagesRepo } from '@/server/db/repositories/images';
import { productsRepo } from '@/server/db/repositories/products';
import { ymlXml, type TestOffer } from './helpers';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const LATER = new Date('2026-10-23T10:00:00.000Z');

async function run(db: Db, xml: string, opts: Parameters<typeof applyImport>[2] = {}) {
  const plan = planImport(parseYml(xml), db, { fileName: 'test.yml', now: NOW });
  return { plan, report: await applyImport(plan, db, { now: NOW, ...opts }) };
}

const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const A: TestOffer = {
  id: '100',
  name: 'Генератор А',
  model: 'GA-1',
  categoryId: '11',
  price: '18990.00000000',
  url: 'https://champion.ru/catalog/gen/generator-a/',
  description: '<p>Описание</p>',
  pictures: ['https://champion.ru/a1.jpg', 'https://champion.ru/a2.jpg'],
  params: [['Мощность, кВт', '2,5'], ['Тип', 'Бензиновый']],
};
const B: TestOffer = { id: '101', name: 'Генератор Б', model: 'GB-1', categoryId: '10', price: '500', available: 'false', url: 'https://champion.ru/catalog/gen/generator-b/' };

describe('planImport: предпросмотр', () => {
  it('на пустой БД всё «создать» и ничего не пишет', () => {
    const db = createTestDb();
    const plan = planImport(parseYml(ymlXml({ offers: [A, B] })), db);
    expect(plan.summary).toEqual({ categories: { create: 2, update: 0, unchanged: 0 }, products: { create: 2, update: 0, unchanged: 0 }, errors: 0 });
    expect(count(db, 'products') + count(db, 'categories') + count(db, 'import_runs')).toBe(0);
  });

  it('товар с неизвестной категорией — в ошибки, остальные в плане', () => {
    const db = createTestDb();
    const plan = planImport(parseYml(ymlXml({ offers: [A, { ...B, id: '102', categoryId: '999' }] })), db);
    expect(plan.products.map((p) => p.externalId)).toEqual(['100']);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatchObject({ kind: 'offer', externalId: '102' });
    expect(plan.errors[0]?.message).toMatch(/категори/i);
  });

  it('slug: последний сегмент url; категория — транслитерация; конфликты получают суффикс', () => {
    const db = createTestDb();
    const same = { url: 'https://champion.ru/catalog/other/generator-a/' };
    const xml = ymlXml({
      categories: [`<category id="10">Бензиновые генераторы</category>`, `<category id="12">Бензиновые  генераторы!</category>`],
      offers: [{ ...A, categoryId: '10' }, { ...A, id: '200', categoryId: '10', ...same }, { ...A, id: '201', categoryId: '10', url: '' }],
    });
    const plan = planImport(parseYml(xml), db);
    expect(plan.categories.map((c) => c.slug)).toEqual(['benzinovye-generatory', 'benzinovye-generatory-12']);
    expect(plan.products.map((p) => p.slug)).toEqual(['generator-a', 'generator-a-200', 'generator-a-201']);
  });

  it('после применения тот же файл планируется как «без изменений», а изменённая цена — как update', async () => {
    const db = createTestDb();
    await run(db, ymlXml({ offers: [A, B] }));
    expect(planImport(parseYml(ymlXml({ offers: [A, B] })), db).summary).toMatchObject({ products: { create: 0, update: 0, unchanged: 2 }, categories: { unchanged: 2 } });
    const plan = planImport(parseYml(ymlXml({ offers: [{ ...A, price: '19990' }, B] })), db);
    expect(plan.summary.products).toEqual({ create: 0, update: 1, unchanged: 1 });
    expect(plan.products[0]?.changes).toEqual(['price']);
  });
});

describe('applyImport: запись', () => {
  it('создаёт категории (2 уровня), товары, характеристики и ссылки на фото; цена в копейках, наличие, артикул', async () => {
    const db = createTestDb();
    const { report } = await run(db, ymlXml({ offers: [A, B] }));
    expect(report.categories).toEqual({ created: 2, updated: 0, unchanged: 0 });
    expect(report.products).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    expect(report.errors).toEqual([]);

    const child = categoriesRepo.findByExternalId(db, 'yml', '11');
    const parent = categoriesRepo.findByExternalId(db, 'yml', '10');
    expect(child?.parentId).toBe(parent?.id);
    expect(parent?.parentId).toBeNull();

    const a = productsRepo.findByExternalId(db, 'yml', '100');
    expect(a).toMatchObject({
      name: 'Генератор А',
      sku: 'GA-1',
      slug: 'generator-a',
      priceKopecks: 1899000,
      discountPriceKopecks: null,
      inStock: true,
      published: true,
      featured: false,
      description: '<p>Описание</p>',
      categoryId: child?.id,
      firstSeenAt: NOW.toISOString(),
      lockedFields: [],
    });
    expect(productsRepo.findByExternalId(db, 'yml', '101')).toMatchObject({ inStock: false, priceKopecks: 50000, sku: 'GB-1', description: null });
    expect(attributesRepo.listByProduct(db, a!.id)).toEqual([{ name: 'Мощность, кВт', value: '2,5' }, { name: 'Тип', value: 'Бензиновый' }]);
    const imgs = imagesRepo.listByProduct(db, a!.id);
    expect(imgs.map((i) => [i.urlSource, i.sort, i.path])).toEqual([['https://champion.ru/a1.jpg', 0, null], ['https://champion.ru/a2.jpg', 1, null]]);
    expect(imgs[0]?.alt).toBe('Генератор А');
    expect(report.images).toMatchObject({ enabled: false, stored: 0, failed: 0, pending: 2 });
  });

  it('повторный импорт того же файла: 0 создано, 0 изменено, без дублей, updated_at не трогается', async () => {
    const db = createTestDb();
    const xml = ymlXml({ offers: [A, B] });
    await run(db, xml);
    const before = productsRepo.findByExternalId(db, 'yml', '100');
    const second = await applyImport(planImport(parseYml(xml), db), db, { now: LATER });
    expect(second.categories).toEqual({ created: 0, updated: 0, unchanged: 2 });
    expect(second.products).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect([count(db, 'products'), count(db, 'categories'), count(db, 'product_images'), count(db, 'product_attributes')]).toEqual([2, 2, 2, 2]);
    expect(productsRepo.findByExternalId(db, 'yml', '100')).toEqual(before);
  });

  it('изменённая цена и наличие обновляются, updated_at меняется, first_seen_at и slug — нет', async () => {
    const db = createTestDb();
    await run(db, ymlXml({ offers: [A, B] }));
    const r = await applyImport(planImport(parseYml(ymlXml({ offers: [{ ...A, price: '20000', available: 'false', name: 'Новое имя', url: 'https://champion.ru/x/new-slug/' }, B] })), db), db, { now: LATER });
    expect(r.products).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    expect(productsRepo.findByExternalId(db, 'yml', '100')).toMatchObject({ priceKopecks: 2000000, inStock: false, name: 'Новое имя', slug: 'generator-a', firstSeenAt: NOW.toISOString(), updatedAt: LATER.toISOString() });
  });

  it('товар, которого нет в новом файле, остаётся в БД', async () => {
    const db = createTestDb();
    await run(db, ymlXml({ offers: [A, B] }));
    const r = await run(db, ymlXml({ offers: [A] }));
    expect(r.report.products).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(productsRepo.findByExternalId(db, 'yml', '101')).toBeDefined();
    expect(count(db, 'products')).toBe(2);
  });

  it('поля из locked_fields не перезаписываются; остальные обновляются; пропуск виден в предпросмотре и отчёте', async () => {
    const db = createTestDb();
    await run(db, ymlXml({ offers: [A] }));
    const id = productsRepo.findByExternalId(db, 'yml', '100')!.id;
    productsRepo.setLockedFields(db, id, ['price', 'name', 'attributes']);
    const xml = ymlXml({ offers: [{ ...A, price: '1', name: 'Чужое имя', available: 'false', params: [['Тип', 'Другой']] }] });
    const plan = planImport(parseYml(xml), db);
    expect(plan.products[0]).toMatchObject({ action: 'update', changes: ['in_stock'], lockedSkipped: ['name', 'price', 'attributes'] });
    const report = await applyImport(plan, db, { now: LATER });
    expect(report.products).toMatchObject({ updated: 1, lockedFieldsSkipped: 3 });
    const p = productsRepo.findByExternalId(db, 'yml', '100')!;
    expect(p).toMatchObject({ name: 'Генератор А', priceKopecks: 1899000, inStock: false });
    expect(attributesRepo.listByProduct(db, p.id)).toHaveLength(2);
  });

  it('SEO-поля категории и признаки товара (published, featured, скидочная цена) импорт не затирает', async () => {
    const db = createTestDb();
    await run(db, ymlXml({ offers: [A] }));
    const cat = categoriesRepo.findByExternalId(db, 'yml', '11')!;
    db.prepare('UPDATE categories SET seo_title = ?, seo_text = ? WHERE id = ?').run('Мой заголовок', 'Мой текст', cat.id);
    db.prepare("UPDATE products SET published = 0, featured = 1, discount_price_kopecks = 1000 WHERE external_id = '100'").run();
    const xml = ymlXml({ categories: [`<category id="10">Генераторы</category>`, `<category id="11" parentId="10">Переименована</category>`], offers: [{ ...A, price: '2' }] });
    await run(db, xml);
    expect(categoriesRepo.findByExternalId(db, 'yml', '11')).toMatchObject({ name: 'Переименована', seoTitle: 'Мой заголовок', seoText: 'Мой текст', slug: cat.slug });
    expect(productsRepo.findByExternalId(db, 'yml', '100')).toMatchObject({ published: false, featured: true, discountPriceKopecks: 1000, priceKopecks: 200 });
  });

  it('смена родителя категории применяется', async () => {
    const db = createTestDb();
    await run(db, ymlXml({ offers: [] }));
    const xml = ymlXml({ categories: [`<category id="10">Генераторы</category>`, `<category id="11">Бензиновые генераторы</category>`], offers: [] });
    const r = await run(db, xml);
    expect(r.report.categories).toMatchObject({ updated: 1, unchanged: 1 });
    expect(categoriesRepo.findByExternalId(db, 'yml', '11')?.parentId).toBeNull();
  });

  it('идентичность — по (source, external_id): запись другого источника с тем же id не трогается', async () => {
    const db = createTestDb();
    await run(db, ymlXml({ offers: [{ ...A, id: '5', url: 'https://champion.ru/x/other/' }] }));
    const cat = categoriesRepo.findByExternalId(db, 'yml', '11')!;
    db.prepare("INSERT INTO products (source, external_id, name, slug, category_id, price_kopecks, first_seen_at, updated_at) VALUES ('onec', '77', 'Из 1С', 'iz-1s', ?, 100, 'x', 'x')").run(cat.id);
    await run(db, ymlXml({ offers: [{ ...A, id: '77', url: 'https://champion.ru/x/yml-77/' }] }));
    expect(productsRepo.findByExternalId(db, 'onec', '77')).toMatchObject({ name: 'Из 1С', priceKopecks: 100 });
    expect(productsRepo.findByExternalId(db, 'yml', '77')).toMatchObject({ name: 'Генератор А' });
  });

  it('slug, занятый между предпросмотром и применением, не роняет импорт: берётся свободный', async () => {
    const db = createTestDb();
    await run(db, ymlXml({ offers: [{ ...B, id: '1', url: 'https://champion.ru/x/zzz/' }] })); // создаёт категории
    const xml = ymlXml({ offers: [A] });
    const plan = planImport(parseYml(xml), db);
    const cat = categoriesRepo.findByExternalId(db, 'yml', '11')!;
    db.prepare("INSERT INTO products (source, external_id, name, slug, category_id, price_kopecks, first_seen_at, updated_at) VALUES ('manual', 'm', 'Ручной', 'generator-a', ?, 1, 'x', 'x')").run(cat.id);
    const report = await applyImport(plan, db, { now: NOW });
    expect(report.errors).toEqual([]);
    expect(productsRepo.findByExternalId(db, 'yml', '100')?.slug).toBe('generator-a-100');
  });

  it('описание очищается от опасной разметки до записи', async () => {
    const db = createTestDb();
    await run(db, ymlXml({ offers: [{ ...A, description: '<p>Ок</p><script>alert(1)</script>' }] }));
    expect(productsRepo.findByExternalId(db, 'yml', '100')?.description).toBe('<p>Ок</p>');
  });
});

describe('applyImport: ошибки по строкам', () => {
  it('битые строки идут в отчёт, остальные применяются', async () => {
    const db = createTestDb();
    const bad: TestOffer[] = [
      { ...B, id: '2', price: '' },
      { ...B, id: '3', categoryId: '999' },
      { ...B, id: '4', name: '' },
    ];
    const { report } = await run(db, ymlXml({ offers: [A, ...bad, B] }));
    expect(report.products.created).toBe(2);
    expect(report.errors.map((e) => e.externalId).sort()).toEqual(['2', '3', '4']);
    expect(count(db, 'products')).toBe(2);
  });

  it('сбой записи одной строки откатывает только её; импорт продолжается', async () => {
    const db = createTestDb();
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON products WHEN NEW.external_id = '101' BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const { report } = await run(db, ymlXml({ offers: [A, B, { ...A, id: '102', url: 'https://champion.ru/x/c/' }] }));
    expect(report.products.created).toBe(2);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ kind: 'offer', externalId: '101' });
    expect(productsRepo.findByExternalId(db, 'yml', '101')).toBeUndefined();
    expect(productsRepo.findByExternalId(db, 'yml', '102')).toBeDefined();
  });

  it('журнал import_runs: файл, режим, счётчики и ошибки', async () => {
    const db = createTestDb();
    const { report } = await run(db, ymlXml({ offers: [A, { ...B, id: '2', price: '' }] }), { actorId: 7 });
    const row = importRunsRepo.get(db, report.runId)!;
    expect(row).toMatchObject({ fileName: 'test.yml', mode: 'apply', actorId: 7, productsCreated: 1, categoriesCreated: 2, errorCount: 1 });
    expect(row.errors).toHaveLength(1);
    expect(importRunsRepo.list(db)).toHaveLength(1);
  });
});

describe('applyImport: изображения', () => {
  const okStore = async () => ({ path: 'abc-1600.webp', variants: [{ key: 'full', width: 1600, height: 900, path: 'abc-1600.webp' }], width: 1600, height: 900 });

  it('по умолчанию фото не скачиваются; сеть не вызывается', async () => {
    const db = createTestDb();
    const { report } = await run(db, ymlXml({ offers: [A] }));
    expect(report.images.enabled).toBe(false);
    expect(imagesRepo.count(db)).toEqual({ total: 2, stored: 0 });
  });

  it('с images: скачивает, сохраняет path и варианты; сбой одного фото не блокирует импорт и попадает в отчёт', async () => {
    const db = createTestDb();
    const fetched: string[] = [];
    const fetchImage = async (url: string) => {
      fetched.push(url);
      if (url.includes('a2')) throw new ImageFetchError('host_not_allowed', 'Хост не разрешён');
      return { bytes: new Uint8Array([1, 2, 3]) };
    };
    const { report } = await run(db, ymlXml({ offers: [A] }), { images: { fetchImage, storeImage: okStore } });
    expect(report.products.created).toBe(1);
    expect(report.images).toMatchObject({ enabled: true, stored: 1, failed: 1, pending: 1 });
    const err = report.errors.find((e) => e.kind === 'image');
    expect(err).toMatchObject({ externalId: '100' });
    expect(err?.message).toMatch(/a2\.jpg/);
    const imgs = imagesRepo.listByProduct(db, productsRepo.findByExternalId(db, 'yml', '100')!.id);
    expect(imgs[0]).toMatchObject({ path: 'abc-1600.webp' });
    expect(imgs[0]?.variants[0]?.key).toBe('full');
    expect(imgs[1]?.path).toBeNull();
  });

  it('сбой обработки файла (не изображение) тоже не блокирует; одинаковый URL у двух товаров скачивается один раз', async () => {
    const db = createTestDb();
    const shared = 'https://champion.ru/shared.jpg';
    let calls = 0;
    const fetchImage = async () => {
      calls++;
      return { bytes: new Uint8Array([1]) };
    };
    const { report } = await run(db, ymlXml({ offers: [{ ...A, pictures: [shared] }, { ...A, id: '300', url: 'https://champion.ru/x/z/', pictures: [shared] }] }), { images: { fetchImage, storeImage: okStore } });
    expect(calls).toBe(1);
    expect(report.images.stored).toBe(2);
    const bad = await run(createTestDb(), ymlXml({ offers: [A] }), { images: { fetchImage, storeImage: async () => { throw new Error('boom'); } } });
    expect(bad.report.images.failed).toBe(2);
    expect(bad.report.products.created).toBe(1);
  });

  it('повторный импорт с images не перекачивает уже сохранённые фото; новые ссылки докачиваются', async () => {
    const db = createTestDb();
    let calls = 0;
    const images = { fetchImage: async () => { calls++; return { bytes: new Uint8Array([1]) }; }, storeImage: okStore };
    await run(db, ymlXml({ offers: [A] }), { images });
    expect(calls).toBe(2);
    await run(db, ymlXml({ offers: [A] }), { images });
    expect(calls).toBe(2);
    await run(db, ymlXml({ offers: [{ ...A, pictures: [...(A.pictures ?? []), 'https://champion.ru/a3.jpg'] }] }), { images });
    expect(calls).toBe(3);
    expect(imagesRepo.count(db)).toEqual({ total: 3, stored: 3 });
  });
});
