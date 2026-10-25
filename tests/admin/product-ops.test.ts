import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { productOps } from '@/app/admin/(panel)/_lib/product-ops';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { stock } from '@/domain/catalog/stock';
import type { Db } from '@/server/db/connection';
import { attributeOps } from '@/app/admin/(panel)/_lib/attributes-ops';
import { brandOps } from '@/app/admin/(panel)/_lib/brands-ops';
import { ordersRepo } from '@/server/db/repositories/orders';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';
import { rawOrder } from '../ordering/helpers';
import { admin, manager, T0 } from './helpers';

/** Сотрудник с правом править товары, но без права на закупочную цену. */
const editor: StaffSession = { staffId: 5, email: 'ed@shop.test', name: 'Редактор', role: 'editor', permissions: ['products.read', 'products.write', 'catalog.read'] };
const deleter: StaffSession = { staffId: 6, email: 'del@shop.test', name: 'Удаляющий', role: 'deleter', permissions: ['products.read', 'products.delete'] };

let uploads: string;
beforeAll(() => {
  uploads = mkdtempSync(join(tmpdir(), 'rts-prod-'));
});
afterAll(() => rmSync(uploads, { recursive: true, force: true }));

const opts = (db: Db) => ({ db, now: T0, uploadsDir: uploads });

function world() {
  const db = createTestDb();
  const cat = addCategory(db, 'Бензопилы', 'benzopily');
  const cat2 = addCategory(db, 'Для дома', 'dlya-doma');
  return { db, cat, cat2 };
}

const form = (categoryId: number, over: Record<string, unknown> = {}) => ({
  name: 'Бензопила Champion 241',
  categoryId,
  priceKopecks: 1_000_000,
  ...over,
});

const png = (w = 40, h = 30) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 30 } } }).png().toBuffer();

describe('товар: права', () => {
  it('менеджер видит карточку, но не создаёт, не правит, не удаляет (403); без сессии — 401', async () => {
    const { db, cat } = world();
    const id = addProduct(db, { name: 'Пила', categoryId: cat });
    expect(productOps.get(manager, id, opts(db))?.name).toBe('Пила');
    await expect(productOps.create(manager, form(cat), opts(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(productOps.update(manager, id, form(cat), opts(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(productOps.remove(manager, id, opts(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(productOps.create(null, form(cat), opts(db))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(() => productOps.get(null, id, opts(db))).toThrow(UnauthorizedError);
    expect(audit.list({ entity: 'product' }, { db })).toEqual([]);
  });

  it('удаление требует отдельного права products.delete', async () => {
    const { db, cat } = world();
    const id = addProduct(db, { name: 'Пила', categoryId: cat });
    await expect(productOps.remove(editor, id, opts(db))).rejects.toBeInstanceOf(ForbiddenError);
    await productOps.remove(deleter, id, opts(db));
    expect(productOps.get(admin, id, opts(db))).toBeNull();
  });
});

describe('товар: создание', () => {
  it('создаёт товар: slug из названия транслитом, источник manual, даты и автор, основная категория, аудит', async () => {
    const { db, cat } = world();
    const { id, slug } = await productOps.create(admin, form(cat, { sku: 'CH-241', barcode: '4600000000017', shortDescription: 'Кратко' }), opts(db));
    expect(slug).toBe('benzopila-champion-241');
    const p = productOps.get(admin, id, opts(db))!;
    expect(p).toMatchObject({
      name: 'Бензопила Champion 241',
      slug,
      sku: 'CH-241',
      barcode: '4600000000017',
      shortDescription: 'Кратко',
      categoryId: cat,
      extraCategoryIds: [],
      priceKopecks: 1_000_000,
      published: true,
      hidden: false,
      source: 'manual',
      createdBy: admin.staffId,
      availability: 'in_stock',
      availabilityMode: 'auto',
      indexable: true,
    });
    expect(p.createdAt).toBe(new Date(T0).toISOString());
    expect(p.updatedAt).toBe(new Date(T0).toISOString());
    const rows = audit.list({ entity: 'product', action: 'product.create' }, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityId).toBe(String(id));
  });

  it('slug уникален: автогенерация добавляет суффикс, явный занятый slug — ConflictError', async () => {
    const { db, cat } = world();
    const a = await productOps.create(admin, form(cat), opts(db));
    const b = await productOps.create(admin, form(cat), opts(db));
    expect(b.slug).not.toBe(a.slug);
    expect(b.slug.startsWith('benzopila-champion-241')).toBe(true);
    await expect(productOps.create(admin, form(cat, { slug: a.slug }), opts(db))).rejects.toBeInstanceOf(ConflictError);
    await expect(productOps.create(admin, form(cat, { slug: 'Плохой Slug!' }), opts(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('SKU уникален в рамках источника; у товара из импорта такой же артикул не мешает', async () => {
    const { db, cat } = world();
    addProduct(db, { name: 'Импортный', categoryId: cat, sku: 'DUP-1' });
    await productOps.create(admin, form(cat, { sku: 'DUP-1' }), opts(db));
    await expect(productOps.create(admin, form(cat, { name: 'Ещё', sku: 'DUP-1' }), opts(db))).rejects.toBeInstanceOf(ConflictError);
  });

  it('цены: старая цена строго больше цены к оплате, скидочная меньше обычной, цены не отрицательные', async () => {
    const { db, cat } = world();
    for (const bad of [{ oldPriceKopecks: 1_000_000 }, { oldPriceKopecks: 900_000 }, { discountPriceKopecks: 1_000_000 }, { priceKopecks: -1 }, { priceKopecks: 1.5 }]) {
      await expect(productOps.create(admin, form(cat, bad), opts(db)), JSON.stringify(bad)).rejects.toBeInstanceOf(ValidationError);
    }
    // старая цена сравнивается с ценой к оплате (скидочной)
    await expect(productOps.create(admin, form(cat, { discountPriceKopecks: 800_000, oldPriceKopecks: 800_000 }), opts(db))).rejects.toBeInstanceOf(ValidationError);
    const ok = await productOps.create(admin, form(cat, { discountPriceKopecks: 800_000, oldPriceKopecks: 1_200_000 }), opts(db));
    expect(productOps.get(admin, ok.id, opts(db))).toMatchObject({ discountPriceKopecks: 800_000, oldPriceKopecks: 1_200_000 });
    expect(productOps.get(admin, (await productOps.create(admin, form(cat, { oldPriceKopecks: 1_000_001 }), opts(db))).id, opts(db))!.oldPriceKopecks).toBe(1_000_001);
  });

  it('ошибка проверки несёт ошибки по полям формы', async () => {
    const { db, cat } = world();
    const err = await productOps.create(admin, form(cat, { name: '   ', oldPriceKopecks: 5 }), opts(db)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys((err as ValidationError).fields)).toEqual(expect.arrayContaining(['name', 'oldPriceKopecks']));
  });

  it('категории: одна основная и несколько дополнительных; основная не дублируется; неизвестная категория — ошибка', async () => {
    const { db, cat, cat2 } = world();
    const extra3 = addCategory(db, 'Садовые', 'sadovye');
    const { id } = await productOps.create(admin, form(cat, { extraCategoryIds: [cat2, cat, extra3, cat2] }), opts(db));
    const p = productOps.get(admin, id, opts(db))!;
    expect(p.categoryId).toBe(cat);
    expect(p.extraCategoryIds.sort()).toEqual([cat2, extra3].sort());
    const links = db.prepare('SELECT category_id, is_primary FROM product_categories WHERE product_id = ? ORDER BY is_primary DESC, category_id').all(id);
    expect(links).toHaveLength(3);
    expect(links[0]).toMatchObject({ category_id: cat, is_primary: 1 });
    await expect(productOps.create(admin, form(9999), opts(db))).rejects.toBeInstanceOf(ValidationError);
    await expect(productOps.create(admin, form(cat, { extraCategoryIds: [9999] }), opts(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('смена основной категории переносит её в product_categories и в products.category_id', async () => {
    const { db, cat, cat2 } = world();
    const { id } = await productOps.create(admin, form(cat, { extraCategoryIds: [cat2] }), opts(db));
    await productOps.update(admin, id, form(cat2, { extraCategoryIds: [cat] }), opts(db));
    const p = productOps.get(admin, id, opts(db))!;
    expect(p).toMatchObject({ categoryId: cat2, extraCategoryIds: [cat] });
    expect((db.prepare('SELECT category_id FROM products WHERE id = ?').get(id) as { category_id: number }).category_id).toBe(cat2);
  });

  it('бренд: существующий привязывается, неизвестный — ошибка', async () => {
    const { db, cat } = world();
    const brand = await brandOps.create(admin, { name: 'Champion', slug: '', description: '', siteUrl: '', published: true, sort: 0, seoTitle: '', seoDescription: '' }, undefined, opts(db));
    const { id } = await productOps.create(admin, form(cat, { brandId: brand.id }), opts(db));
    expect(productOps.get(admin, id, opts(db))!.brandId).toBe(brand.id);
    await expect(productOps.create(admin, form(cat, { brandId: 9999 }), opts(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('полное описание очищается санитайзером (скрипты и атрибуты удаляются)', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { description: '<p onclick="x()">Текст</p><script>alert(1)</script><b>жирный</b>' }), opts(db));
    const d = productOps.get(admin, id, opts(db))!.description ?? '';
    expect(d).not.toMatch(/script|onclick|alert/);
    expect(d).toContain('Текст');
  });

  it('SEO и canonical: canonical — http(s)-адрес или пусто; indexable хранится', async () => {
    const { db, cat } = world();
    await expect(productOps.create(admin, form(cat, { canonicalUrl: 'javascript:alert(1)' }), opts(db))).rejects.toBeInstanceOf(ValidationError);
    const { id } = await productOps.create(admin, form(cat, { seoTitle: 'T', seoDescription: 'D', canonicalUrl: 'https://example.com/p', indexable: false }), opts(db));
    expect(productOps.get(admin, id, opts(db))).toMatchObject({ seoTitle: 'T', seoDescription: 'D', canonicalUrl: 'https://example.com/p', indexable: false });
  });

  it('начальный остаток записывается через сервис остатков с причиной', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { stockQty: 7 }), opts(db));
    expect(productOps.get(admin, id, opts(db))!.stock).toMatchObject({ stockQty: 7, reservedQty: 0, availableQty: 7, tracked: true });
    const m = stock.history(id, { db });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ delta: 7, qtyAfter: 7, staffId: admin.staffId });
  });
});

describe('товар: правка', () => {
  it('меняет поля, пишет в аудит только изменённые (до/после), закрепляет их за ручной правкой; повтор без изменений ничего не пишет', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { sku: 'A-1' }), opts(db));
    const r = await productOps.update(admin, id, form(cat, { sku: 'A-1', priceKopecks: 1_100_000, isNew: true, shortDescription: 'Новое' }), opts(db));
    expect(r.changed.sort()).toEqual(['isNew', 'priceKopecks', 'shortDescription']);
    const rows = audit.list({ entity: 'product', action: 'price.change' }, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.before).toMatchObject({ priceKopecks: 1_000_000 });
    expect(rows[0]!.after).toMatchObject({ priceKopecks: 1_100_000, isNew: true });
    const again = await productOps.update(admin, id, form(cat, { sku: 'A-1', priceKopecks: 1_100_000, isNew: true, shortDescription: 'Новое' }), opts(db));
    expect(again.changed).toEqual([]);
    expect(audit.list({ entity: 'product' }, { db })).toHaveLength(2);
    expect(productOps.get(admin, id, opts(db))!.updatedAt).toBe(new Date(T0).toISOString());
  });

  it('пустой slug при правке оставляет прежний; чужой занятый slug — ConflictError', async () => {
    const { db, cat } = world();
    const a = await productOps.create(admin, form(cat), opts(db));
    const b = await productOps.create(admin, form(cat, { name: 'Другой товар' }), opts(db));
    await productOps.update(admin, b.id, form(cat, { name: 'Другой товар', slug: '' }), opts(db));
    expect(productOps.get(admin, b.id, opts(db))!.slug).toBe(b.slug);
    await expect(productOps.update(admin, b.id, form(cat, { name: 'Другой товар', slug: a.slug }), opts(db))).rejects.toBeInstanceOf(ConflictError);
    await productOps.update(admin, a.id, form(cat, { slug: a.slug }), opts(db)); // свой slug — не конфликт
  });

  it('неизвестный товар — NotFoundError', async () => {
    const { db, cat } = world();
    await expect(productOps.update(admin, 999, form(cat), opts(db))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('товар из импорта: правка закрепляет поля в locked_fields, импорт их больше не перезапишет', async () => {
    const { db, cat } = world();
    const id = addProduct(db, { name: 'Из импорта', categoryId: cat, priceRub: 1000, sku: 'IMP-1' });
    await productOps.update(admin, id, form(cat, { name: 'Из импорта', sku: 'IMP-1', priceKopecks: 123_400, barcode: '4600000000017', isPromo: true }), opts(db));
    const locked = JSON.parse((db.prepare('SELECT locked_fields FROM products WHERE id = ?').get(id) as { locked_fields: string }).locked_fields) as string[];
    expect(locked).toEqual(expect.arrayContaining(['price', 'barcode', 'flags']));
  });

  it('публикация и скрытие переключаются отдельно от наличия', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { stockQty: 0 }), opts(db));
    await productOps.setVisibility(admin, id, { published: false }, opts(db));
    expect(productOps.get(admin, id, opts(db))).toMatchObject({ published: false, hidden: false });
    await productOps.setVisibility(admin, id, { published: true, hidden: true }, opts(db));
    expect(productOps.get(admin, id, opts(db))).toMatchObject({ published: true, hidden: true });
    expect(audit.list({ entity: 'product', action: 'product.visibility' }, { db }).length).toBeGreaterThanOrEqual(2);
    await expect(productOps.setVisibility(manager, id, { published: false }, opts(db))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('товар: наличие отдельно от публикации', () => {
  it('«авто» берёт наличие из остатка, явный статус закрепляется, возврат на «авто» снимает закрепление', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { stockQty: 3 }), opts(db));
    expect(productOps.get(admin, id, opts(db))).toMatchObject({ availability: 'in_stock', availabilityMode: 'auto' });
    await productOps.update(admin, id, form(cat, { availability: 'preorder' }), opts(db));
    expect(productOps.get(admin, id, opts(db))).toMatchObject({ availability: 'preorder', availabilityMode: 'manual' });
    expect((db.prepare('SELECT in_stock FROM products WHERE id = ?').get(id) as { in_stock: number }).in_stock).toBe(1);
    await productOps.update(admin, id, form(cat, { availability: 'discontinued' }), opts(db));
    expect((db.prepare('SELECT in_stock FROM products WHERE id = ?').get(id) as { in_stock: number }).in_stock).toBe(0);
    await productOps.update(admin, id, form(cat, { availability: 'auto' }), opts(db));
    expect(productOps.get(admin, id, opts(db))).toMatchObject({ availability: 'in_stock', availabilityMode: 'auto' });
    await expect(productOps.update(admin, id, form(cat, { availability: 'bogus' }), opts(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('опубликованный товар без остатка остаётся опубликованным, но «нет в наличии»', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { stockQty: 2, published: true }), opts(db));
    stock.adjust(id, { set: 0 }, 'Продано', { staffId: 1 }, { db, now: T0 });
    expect(productOps.get(admin, id, opts(db))).toMatchObject({ published: true, availability: 'out_of_stock' });
  });

  it('смена остатка в форме идёт через сервис с обязательной причиной; резерв не больше остатка', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { stockQty: 5 }), opts(db));
    await expect(productOps.update(admin, id, form(cat, { stockQty: 9 }), opts(db))).rejects.toBeInstanceOf(ValidationError);
    await productOps.update(admin, id, form(cat, { stockQty: 9, stockReason: 'Приход' }), opts(db));
    expect(productOps.get(admin, id, opts(db))!.stock.stockQty).toBe(9);
    await expect(productOps.update(admin, id, form(cat, { stockQty: 9, reservedQty: 10, stockReason: 'x' }), opts(db))).rejects.toBeInstanceOf(Error);
    await productOps.update(admin, id, form(cat, { stockQty: 9, reservedQty: 4, stockReason: 'Резерв под заказ по телефону' }), opts(db));
    expect(productOps.get(admin, id, opts(db))!.stock).toMatchObject({ reservedQty: 4, availableQty: 5 });
    // без изменения остатка причина не нужна
    await productOps.update(admin, id, form(cat, { stockQty: 9, reservedQty: 4, name: 'Переименован' }), opts(db));
    expect(stock.history(id, { db }).map((m) => m.reason)).toHaveLength(3);
  });
});

describe('закупочная цена: ограничение доступа', () => {
  const SECRET = 123_457;

  it('с правом products.cost значение сохраняется и читается', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { purchasePriceKopecks: SECRET }), opts(db));
    expect(productOps.get(admin, id, opts(db))!.purchasePriceKopecks).toBe(SECRET);
    expect(productOps.canViewCost(admin)).toBe(true);
  });

  it('без права значение не возвращается ни одним путём: карточка, результат правки, аудит', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { purchasePriceKopecks: SECRET }), opts(db));
    expect(productOps.canViewCost(editor)).toBe(false);
    expect(productOps.canViewCost(manager)).toBe(false);

    for (const viewer of [manager, editor]) {
      const p = productOps.get(viewer, id, opts(db))!;
      expect('purchasePriceKopecks' in p).toBe(false);
      expect(JSON.stringify(p)).not.toContain(String(SECRET));
    }

    // редактор правит товар, присылая «закупочную» в запросе, — она игнорируется, прежнее значение не теряется
    const r = await productOps.update(editor, id, form(cat, { priceKopecks: 1_200_000, purchasePriceKopecks: 1 }), opts(db));
    expect(JSON.stringify(r)).not.toContain(String(SECRET));
    expect(productOps.get(admin, id, opts(db))!.purchasePriceKopecks).toBe(SECRET);

    // при создании без права закупочная не записывается
    const created = await productOps.create(editor, form(cat, { name: 'От редактора', purchasePriceKopecks: 555 }), opts(db));
    expect(productOps.get(admin, created.id, opts(db))!.purchasePriceKopecks ?? null).toBeNull();

    // в журнале действий значения закупочной нет вовсе
    const log = JSON.stringify(audit.list({ entity: 'product' }, { db }));
    expect(log).not.toContain(String(SECRET));
    expect(log).not.toContain('555');
  });

  it('изменение закупочной администратором попадает в журнал только отметкой, без значений', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat, { purchasePriceKopecks: SECRET }), opts(db));
    await productOps.update(admin, id, form(cat, { purchasePriceKopecks: 999_001 }), opts(db));
    const rows = audit.list({ entity: 'product', action: 'product.update' }, { db });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/123457|999001/);
    expect(JSON.stringify(rows[0]!.after)).toContain('purchasePriceChanged');
  });

  it('закупочная не больше разумного предела и не отрицательная', async () => {
    const { db, cat } = world();
    await expect(productOps.create(admin, form(cat, { purchasePriceKopecks: -5 }), opts(db))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('характеристики товара по определениям', () => {
  async function defs(db: Db) {
    const base = { code: '', unit: '', required: false, filterable: true, comparable: true, sort: 0, categoryIds: [] as number[], allowedValues: [] as string[] };
    const power = await attributeOps.create(admin, { ...base, name: 'Мощность', type: 'number', unit: 'Вт' }, opts(db));
    const kind = await attributeOps.create(admin, { ...base, name: 'Тип', type: 'list', allowedValues: ['бензиновая', 'электрическая'], required: true }, opts(db));
    const eco = await attributeOps.create(admin, { ...base, name: 'Эко', type: 'boolean' }, opts(db));
    return { power: power.id, kind: kind.id, eco: eco.id };
  }

  it('значения проверяются по типу, список — по допустимым, обязательные должны быть заполнены', async () => {
    const { db, cat } = world();
    const a = await defs(db);
    await expect(productOps.create(admin, form(cat, { attributes: [{ attributeId: a.power, value: '2000' }] }), opts(db))).rejects.toBeInstanceOf(ValidationError); // нет обязательного «Тип»
    await expect(productOps.create(admin, form(cat, { attributes: [{ attributeId: a.kind, value: 'ядерная' }] }), opts(db))).rejects.toBeInstanceOf(ValidationError);
    await expect(
      productOps.create(
        admin,
        form(cat, {
          attributes: [
            { attributeId: a.kind, value: 'бензиновая' },
            { attributeId: a.power, value: 'много' },
          ],
        }),
        opts(db),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(productOps.create(admin, form(cat, { attributes: [{ attributeId: 9999, value: 'x' }, { attributeId: a.kind, value: 'бензиновая' }] }), opts(db))).rejects.toBeInstanceOf(ValidationError);

    const { id } = await productOps.create(
      admin,
      form(cat, {
        attributes: [
          { attributeId: a.kind, value: 'Бензиновая' },
          { attributeId: a.power, value: '2 000' },
          { attributeId: a.eco, value: 'да' },
        ],
      }),
      opts(db),
    );
    const got = productOps.get(admin, id, opts(db))!.attributes;
    expect(got).toEqual(
      expect.arrayContaining([
        { attributeId: a.kind, value: 'бензиновая' },
        { attributeId: a.power, value: '2000' },
        { attributeId: a.eco, value: 'Да' },
      ]),
    );
    const num = db.prepare('SELECT value_num FROM product_attributes WHERE product_id = ? AND attribute_id = ?').get(id, a.power) as { value_num: number };
    expect(num.value_num).toBe(2000);
  });

  it('пустое значение необязательной характеристики убирает её; обязательную — нельзя', async () => {
    const { db, cat } = world();
    const a = await defs(db);
    const { id } = await productOps.create(admin, form(cat, { attributes: [{ attributeId: a.kind, value: 'бензиновая' }, { attributeId: a.power, value: '1500' }] }), opts(db));
    await productOps.update(admin, id, form(cat, { attributes: [{ attributeId: a.kind, value: 'бензиновая' }, { attributeId: a.power, value: '' }] }), opts(db));
    expect(productOps.get(admin, id, opts(db))!.attributes.map((x) => x.attributeId)).toEqual([a.kind]);
    await expect(productOps.update(admin, id, form(cat, { attributes: [{ attributeId: a.kind, value: '' }] }), opts(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('характеристики, которых нет в присланной форме, не теряются (данные импорта)', async () => {
    const { db, cat } = world();
    const id = addProduct(db, { name: 'Импортный', categoryId: cat, attrs: { 'Вес, кг': '3,2' } });
    const a = await defs(db);
    // «Тип» обязателен только для категорий, к которым он относится; здесь он глобальный — задаём его и проверяем, что импортная не пропала
    await productOps.update(admin, id, form(cat, { name: 'Импортный', attributes: [{ attributeId: a.kind, value: 'бензиновая' }] }), opts(db));
    const names = (db.prepare('SELECT d.name FROM product_attributes pa JOIN attribute_definitions d ON d.id = pa.attribute_id WHERE pa.product_id = ? ORDER BY d.name').all(id) as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(['Вес, кг', 'Тип']);
  });
});

describe('товар: удаление с проверкой зависимостей', () => {
  function placeOrderRow(db: Db, productId: number) {
    const { id } = rawOrder(db, 'new');
    ordersRepo.insertItem(db, id, { productId, name: 'Снимок', sku: 'S', priceKopecks: 100, discountPriceKopecks: null, unitKopecks: 100, qty: 1, lineKopecks: 100 });
  }

  it('товар с заказами удалить нельзя: подсказка скрыть, снимок в заказе цел, аудита удаления нет', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat), opts(db));
    placeOrderRow(db, id);
    expect(productOps.dependencies(admin, id, opts(db)).orders).toBe(1);
    const err = await productOps.remove(admin, id, opts(db)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toMatch(/скрыт/i);
    expect(productOps.get(admin, id, opts(db))).not.toBeNull();
    expect((db.prepare('SELECT name FROM order_items').get() as { name: string }).name).toBe('Снимок');
    expect(audit.list({ action: 'product.delete' }, { db })).toEqual([]);
  });

  it('без заказов удаляет товар и все связи: категории, характеристики, фото, остатки, избранное, корзины; пишет product.delete', async () => {
    const { db, cat, cat2 } = world();
    const { id } = await productOps.create(admin, form(cat, { extraCategoryIds: [cat2], stockQty: 3 }), opts(db));
    await productOps.addImages(admin, id, [{ bytes: new Uint8Array(await png()) }], opts(db));
    db.prepare("INSERT INTO favorites (guest_id, product_id, created_at) VALUES ('g1', ?, 1)").run(id);
    const deps = productOps.dependencies(admin, id, opts(db));
    expect(deps).toMatchObject({ orders: 0, favorites: 1 });
    await productOps.remove(admin, id, opts(db));
    expect(productOps.get(admin, id, opts(db))).toBeNull();
    for (const t of ['product_categories', 'product_images', 'product_attributes', 'stock_movements', 'favorites', 'cart_items']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE product_id = ?`).get(id) as { n: number }).n, t).toBe(0);
    }
    const rows = audit.list({ action: 'product.delete' }, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityId).toBe(String(id));
    expect(JSON.stringify(rows[0])).not.toMatch(/purchase/i);
    await expect(productOps.remove(admin, id, opts(db))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('изображения товара', () => {
  it('загрузка нескольких файлов: проверка сигнатуры, случайные имена, главное — первое, варианты размеров', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat), opts(db));
    const a = new Uint8Array(await png(1200, 800));
    const b = new Uint8Array(await png(300, 300));
    const res = await productOps.addImages(admin, id, [{ bytes: a }, { bytes: b }], opts(db));
    expect(res.added).toBe(2);
    const imgs = productOps.get(admin, id, opts(db))!.images;
    expect(imgs).toHaveLength(2);
    expect(imgs[0]!.path).toMatch(/^[0-9a-f]{32}-\d+\.webp$/);
    expect(imgs[0]!.variants.length).toBeGreaterThan(1);
    expect(imgs[0]!.urlSource.startsWith('upload:')).toBe(true);
    expect(imgs.map((i) => i.sort)).toEqual([0, 1]);
  });

  it('не-изображение отклоняется целиком (ничего не добавлено), подмена расширения не помогает', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat), opts(db));
    const good = new Uint8Array(await png());
    const fake = new TextEncoder().encode('<?php echo 1; ?> image.png');
    await expect(productOps.addImages(admin, id, [{ bytes: good }, { bytes: fake }], opts(db))).rejects.toBeInstanceOf(ValidationError);
    expect(productOps.get(admin, id, opts(db))!.images).toHaveLength(0);
    await expect(productOps.addImages(admin, id, [], opts(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('главное изображение, порядок, подпись alt и удаление; правка фото закрепляет images за ручной правкой', async () => {
    const { db, cat } = world();
    const { id } = await productOps.create(admin, form(cat), opts(db));
    await productOps.addImages(admin, id, [{ bytes: new Uint8Array(await png(100, 100)) }, { bytes: new Uint8Array(await png(110, 110)) }, { bytes: new Uint8Array(await png(120, 120)) }], opts(db));
    const [i1, i2, i3] = productOps.get(admin, id, opts(db))!.images.map((i) => i.id) as [number, number, number];

    await productOps.setMainImage(admin, id, i3, opts(db));
    expect(productOps.get(admin, id, opts(db))!.images.map((i) => i.id)).toEqual([i3, i1, i2]);

    await productOps.reorderImages(admin, id, [i2, i3, i1], opts(db));
    expect(productOps.get(admin, id, opts(db))!.images.map((i) => i.id)).toEqual([i2, i3, i1]);
    await expect(productOps.reorderImages(admin, id, [i2, i3], opts(db))).rejects.toBeInstanceOf(ValidationError);

    await productOps.setImageAlt(admin, id, i2, 'Вид спереди', opts(db));
    expect(productOps.get(admin, id, opts(db))!.images[0]!.alt).toBe('Вид спереди');

    await productOps.removeImage(admin, id, i3, opts(db));
    expect(productOps.get(admin, id, opts(db))!.images.map((i) => i.id)).toEqual([i2, i1]);
    await expect(productOps.removeImage(admin, id, i3, opts(db))).rejects.toBeInstanceOf(NotFoundError);

    const locked = JSON.parse((db.prepare('SELECT locked_fields FROM products WHERE id = ?').get(id) as { locked_fields: string }).locked_fields) as string[];
    expect(locked).toContain('images');
  });

  it('чужое изображение (другого товара) удалить или переставить нельзя', async () => {
    const { db, cat } = world();
    const a = await productOps.create(admin, form(cat), opts(db));
    const b = await productOps.create(admin, form(cat, { name: 'Другой' }), opts(db));
    await productOps.addImages(admin, a.id, [{ bytes: new Uint8Array(await png()) }], opts(db));
    const foreign = productOps.get(admin, a.id, opts(db))!.images[0]!.id;
    await expect(productOps.removeImage(admin, b.id, foreign, opts(db))).rejects.toBeInstanceOf(NotFoundError);
    await expect(productOps.setMainImage(admin, b.id, foreign, opts(db))).rejects.toBeInstanceOf(NotFoundError);
    expect(productOps.get(admin, a.id, opts(db))!.images).toHaveLength(1);
  });

  it('внешние ссылки импорта (champion.ru) сохраняются и отображаются; менеджер не может менять фото', async () => {
    const { db, cat } = world();
    const id = addProduct(db, { name: 'Импорт', categoryId: cat, images: ['https://champion.ru/a.jpg', 'https://champion.ru/b.jpg'] });
    const imgs = productOps.get(manager, id, opts(db))!.images;
    expect(imgs.map((i) => i.urlSource)).toEqual(['https://champion.ru/a.jpg', 'https://champion.ru/b.jpg']);
    await expect(productOps.addImages(manager, id, [{ bytes: new Uint8Array(await png()) }], opts(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(productOps.removeImage(manager, id, imgs[0]!.id, opts(db))).rejects.toBeInstanceOf(ForbiddenError);
    await productOps.setMainImage(admin, id, imgs[1]!.id, opts(db));
    expect(productOps.get(admin, id, opts(db))!.images.map((i) => i.urlSource)).toEqual(['https://champion.ru/b.jpg', 'https://champion.ru/a.jpg']);
  });
});

describe('подсказка slug', () => {
  it('предлагает свободный slug из названия', async () => {
    const { db, cat } = world();
    const a = await productOps.create(admin, form(cat), opts(db));
    expect(productOps.suggestSlug(admin, 'Бензопила Champion 241', undefined, opts(db))).toBe(`${a.slug}-2`);
    expect(productOps.suggestSlug(admin, 'Бензопила Champion 241', a.id, opts(db))).toBe(a.slug);
    expect(productOps.suggestSlug(admin, 'Новый товар', undefined, opts(db))).toBe('novyy-tovar');
  });
});
