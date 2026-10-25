import { describe, expect, it } from 'vitest';
import { productOps } from '@/app/admin/(panel)/_lib/product-ops';
import { applyImport, parseYml, planImport } from '@/importing/yml';
import { LOCKABLE_FIELDS } from '@/importing/yml/types';
import { brandsRepo } from '@/server/db/repositories/brands';
import { createTestDb } from '@/server/db/testing';
import { ymlXml } from '../importing/helpers';
import { admin, importXml, productByExternal, T0 } from './helpers';

const opts = (db: ReturnType<typeof createTestDb>) => ({ db, now: T0 });

/** Файл с вендором: тест проверяет, что импорт не затирает бренд, выбранный вручную. */
const FILE = (price: string, name = 'Генератор', inStock = true) =>
  ymlXml({ offers: [{ id: '1', name, price, available: inStock ? 'true' : 'false', description: '<p>Из файла</p>' }, { id: '2', name: 'Второй', price: '500.00' }] }).replaceAll(
    '</name>\n<model>',
    '</name>\n<vendor>Champion</vendor>\n<model>',
  );

async function setup() {
  const db = createTestDb();
  await importXml(db, FILE('1000.00'));
  const p = productByExternal(db, '1');
  return { db, id: p.id, categoryId: p.categoryId };
}

const input = (categoryId: number, over: Record<string, unknown> = {}) => ({ name: 'Генератор', sku: 'M-1', categoryId, priceKopecks: 100_000, ...over });

describe('импорт YML не затирает ручные правки новых полей', () => {
  it('закрепляемые поля включают бренд, штрихкод, старую цену, флаги, наличие и остаток', () => {
    for (const f of ['brand', 'barcode', 'old_price', 'short_description', 'flags', 'in_stock', 'images', 'price']) {
      expect(LOCKABLE_FIELDS as readonly string[]).toContain(f);
    }
  });

  it('штрихкод, краткое описание, старая цена, флаги, SEO, закупочная и остаток сохраняются после повторного импорта с другой ценой', async () => {
    const { db, id, categoryId } = await setup();
    await productOps.update(
      admin,
      id,
      input(categoryId, {
        barcode: '4600000000017',
        shortDescription: 'Кратко',
        oldPriceKopecks: 150_000,
        isNew: true,
        isPromo: true,
        featured: true,
        purchasePriceKopecks: 70_000,
        canonicalUrl: 'https://example.com/g',
        indexable: false,
        stockQty: 4,
        stockReason: 'Приход',
      }),
      opts(db),
    );
    const before = productOps.get(admin, id, opts(db))!;

    // файл меняет цену, имя и наличие
    await importXml(db, FILE('2222.00', 'Генератор новый', false));
    const after = productOps.get(admin, id, opts(db))!;
    for (const k of ['barcode', 'shortDescription', 'oldPriceKopecks', 'isNew', 'isPromo', 'featured', 'purchasePriceKopecks', 'canonicalUrl', 'indexable', 'categoryId', 'slug'] as const) {
      expect(after[k], k).toEqual(before[k]);
    }
    expect(after.stock).toMatchObject({ stockQty: 4, tracked: true });
    // наличие закреплено остатком: «нет в наличии» из файла его не меняет
    expect(after.availability).toBe('in_stock');
  });

  it('цена, закреплённая правкой, не перезаписывается; незакреплённые поля обновляются как раньше', async () => {
    const { db, id, categoryId } = await setup();
    await productOps.update(admin, id, input(categoryId, { priceKopecks: 123_400 }), opts(db));
    await importXml(db, FILE('2222.00', 'Генератор новый'));
    const p = productByExternal(db, '1');
    expect(p.priceKopecks).toBe(123_400);
    expect(p.name).toBe('Генератор новый');
  });

  it('бренд, выбранный вручную, закреплён: импорт с другим вендором его не меняет', async () => {
    const { db, id, categoryId } = await setup();
    const manual = brandsRepo.insert(
      db,
      { name: 'Мой бренд', slug: 'moy', description: null, siteUrl: null, published: true, sort: 0, seoTitle: null, seoDescription: null, source: 'yml', externalId: 'moy' },
      new Date(T0).toISOString(),
    );
    await productOps.update(admin, id, input(categoryId, { brandId: manual }), opts(db));
    expect(productOps.get(admin, id, opts(db))!.brandId).toBe(manual);
    await importXml(db, FILE('1000.00'));
    expect(productOps.get(admin, id, opts(db))!.brandId).toBe(manual);
    // у второго товара вручную ничего не менялось — бренд из файла по-прежнему подставляется
    const second = productByExternal(db, '2');
    expect(productOps.get(admin, second.id, opts(db))!.brandId).not.toBeNull();
  });

  it('фото, которые правили вручную (подпись, порядок), не заменяются списком из файла', async () => {
    const db = createTestDb();
    await importXml(db, ymlXml({ offers: [{ id: '1', pictures: ['https://champion.ru/1.jpg'] }] }));
    const id = productByExternal(db, '1').id;
    const imgs = productOps.get(admin, id, opts(db))!.images;
    expect(imgs).toHaveLength(1);
    await productOps.setImageAlt(admin, id, imgs[0]!.id, 'Подпись', opts(db));
    await importXml(db, ymlXml({ offers: [{ id: '1', pictures: ['https://champion.ru/2.jpg', 'https://champion.ru/3.jpg'] }] }));
    expect(productOps.get(admin, id, opts(db))!.images.map((i) => i.urlSource)).toEqual(['https://champion.ru/1.jpg']);
  });

  it('повторный импорт идемпотентен: 0 создано, 0 обновлено, число товаров и категорий не растёт', async () => {
    const { db, id, categoryId } = await setup();
    await productOps.update(admin, id, input(categoryId, { barcode: '4600000000017', isNew: true }), opts(db));
    const run = async () => applyImport(planImport(parseYml(FILE('1000.00')), db, { fileName: 't.yml' }), db, { now: new Date(T0) });
    await run();
    const second = await run();
    expect(second.products).toMatchObject({ created: 0, updated: 0 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n).toBe(2);
    expect((db.prepare('SELECT COUNT(*) AS n FROM product_categories WHERE is_primary = 1').get() as { n: number }).n).toBe(2);
  });

  it('товары, созданные вручную, не удаляются и не меняются импортом', async () => {
    const { db, categoryId } = await setup();
    const { id } = await productOps.create(admin, input(categoryId, { name: 'Ручной', sku: 'HAND-1' }), opts(db));
    await importXml(db, ymlXml({ offers: [{ id: '2', name: 'Только второй' }] }));
    expect(productOps.get(admin, id, opts(db))).toMatchObject({ name: 'Ручной', source: 'manual', published: true });
  });
});
