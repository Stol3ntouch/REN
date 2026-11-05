import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attributeOps } from '@/app/admin/(panel)/_lib/attributes-ops';
import { brandOps } from '@/app/admin/(panel)/_lib/brands-ops';
import { categoryOps } from '@/app/admin/(panel)/_lib/category-ops';
import { importOps } from '@/app/admin/(panel)/_lib/import-ops';
import { productOps } from '@/app/admin/(panel)/_lib/product-ops';
import { categoryVisibilityOps } from '@/app/admin/(panel)/catalog/category-visibility-ops';
import { audit } from '@/domain/admin/audit';
import { rolesService } from '@/domain/admin/roles';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { getStaffSession } from '@/domain/admin/staff-session';
import type { StaffSession } from '@/domain/admin/permissions';
import { getCategoryBySlug, getProductBySlug, searchProducts } from '@/domain/catalog';
import { getShopInfo } from '@/domain/content/settings';
import { getStoreFlags } from '@/domain/content/store-flags';
import { decideStoreGate } from '@/domain/content/store-gate';
import { getStoreSettings, saveStoreSettings } from '@/domain/content/store-settings';
import { orderOps } from '@/domain/ordering/admin-ops';
import { listSitemapEntries } from '@/domain/seo/sitemap';
import { openDatabase, type Db } from '@/server/db/connection';
import { runMigrations } from '@/server/db/migrate';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { ForbiddenError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { fakeCookies } from '../auth/helpers';
import { addCategory, baseQuery } from '../catalog/helpers';
import { csv, utf8 } from '../importing/csv-helpers';
import { placeGuestOrder } from '../security/harness';

/**
 * Сквозные сценарии C13 (тикет, критерий «E2E-сценарии»): десять сценариев администратора на ОДНОЙ изолированной БД
 * (файл во временной папке, миграции проекта; data/rts.sqlite не затрагивается), по порядку, каждый опирается на предыдущие.
 * Проверка «после перезагрузки» — закрыть соединение и открыть файл заново.
 * Те же сценарии по HTTP на собственном сервере — scripts/e2e-admin.ts.
 */
const T = Date.now();
let dir: string;
let uploads: string;
let stagingDir: string;
let dbPath: string;
let db: Db;
let admin: StaffSession;
const ADMIN_PASSWORD = 'admin-pass-long-1';

const opts = () => ({ db, now: T, uploadsDir: uploads });
const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 20, g: 140, b: 40 } } }).png().toBuffer();
const reopen = () => {
  db.close();
  db = openDatabase(dbPath);
  runMigrations(db);
};
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rts-e2e-'));
  uploads = join(dir, 'uploads');
  stagingDir = join(dir, 'staging');
  dbPath = join(dir, 'e2e.sqlite');
  db = openDatabase(dbPath);
  runMigrations(db);
}, 30_000);
afterAll(() => {
  try {
    db.close();
  } catch {
    /* уже закрыта */
  }
  rmSync(dir, { recursive: true, force: true });
});

const ids: { cat?: number; sub?: number; brand?: number; attr?: number; product?: number; order?: number; orderNumber?: string } = {};

describe('сценарии администратора на изолированной БД', () => {
  it('1. вход администратора: верный пароль — сессия; неверный — отказ без раскрытия, сессии нет', async () => {
    const created = await createStaff({ email: 'owner', password: ADMIN_PASSWORD, role: 'super_admin' }, { db, now: T });
    const jar = fakeCookies();
    await loginStaff({ email: 'owner', password: ADMIN_PASSWORD }, { db, cookies: jar, ip: '10.0.0.1', now: T });
    const session = getStaffSession(jar, { db, now: T });
    expect(session).toMatchObject({ staffId: created.staffId, role: 'super_admin' });
    admin = session!;

    const bad = fakeCookies();
    const err = await loginStaff({ email: 'owner', password: 'wrong-password-1' }, { db, cookies: bad, ip: '10.0.0.1', now: T }).catch((e: unknown) => e);
    expect((err as Error).message).toBe('Неверный логин или пароль');
    expect(getStaffSession(bad, { db, now: T })).toBeNull();
    const unknown = await loginStaff({ email: 'nobody', password: 'wrong-password-1' }, { db, cookies: fakeCookies(), ip: '10.0.0.2', now: T }).catch((e: unknown) => e);
    expect((unknown as Error).message).toBe((err as Error).message); // существование логина не раскрывается
  });

  it('3. создание категории (корневая и дочерняя)', () => {
    ids.cat = categoryOps.create(admin, { name: 'Садовая техника', parentId: null }, opts()).id;
    ids.sub = categoryOps.create(admin, { name: 'Триммеры', parentId: ids.cat }, opts()).id;
    expect(categoriesRepo.findById(db, ids.sub)).toMatchObject({ parentId: ids.cat, effectiveHidden: false });
    expect(audit.list({ action: 'category.create' }, { db })).toHaveLength(2);
  });

  it('2. товар с брендом, категориями, характеристикой и изображением', async () => {
    ids.brand = (await brandOps.create(admin, { name: 'Champion', slug: '', description: '', siteUrl: '', published: true, sort: 0, seoTitle: '', seoDescription: '' }, undefined, opts())).id;
    ids.attr = attributeOps.create(
      admin,
      { name: 'Мощность', code: '', type: 'string', unit: 'Вт', required: false, filterable: true, comparable: true, sort: 0, categoryIds: [], allowedValues: [] } as never,
      opts(),
    ).id;
    const created = await productOps.create(
      admin,
      {
        name: 'Триммер бензиновый Champion T523',
        sku: 'T523',
        categoryId: ids.sub!,
        extraCategoryIds: [ids.cat!],
        brandId: ids.brand,
        priceKopecks: 650_000,
        attributes: [{ attributeId: ids.attr, value: '1500' }],
      },
      opts(),
    );
    ids.product = created.id;
    expect((await productOps.addImages(admin, created.id, [{ bytes: await png() }], opts())).added).toBe(1);
    const p = productOps.get(admin, created.id, opts())!;
    expect(p).toMatchObject({ brandId: ids.brand, categoryId: ids.sub, extraCategoryIds: [ids.cat], published: true });
    expect(p.attributes).toEqual([{ attributeId: ids.attr, value: '1500' }]);
    expect(p.images).toHaveLength(1);
    const page = await getProductBySlug(created.slug, { db });
    expect(page?.name).toBe('Триммер бензиновый Champion T523');
  });

  it('4. назначение товара другой категории: появляется в ней и исчезает из прежней', async () => {
    const other = categoryOps.create(admin, { name: 'Косилки', parentId: ids.cat! }, opts()).id;
    const edit = (categoryId: number) => ({ name: 'Триммер бензиновый Champion T523', sku: 'T523', categoryId, extraCategoryIds: [] as number[], brandId: ids.brand, priceKopecks: 650_000, attributes: [{ attributeId: ids.attr!, value: '1500' }] });
    await productOps.update(admin, ids.product!, edit(other), opts());
    const sub = categoriesRepo.findById(db, ids.sub!)!;
    const oth = categoriesRepo.findById(db, other)!;
    expect((await searchProducts({ ...baseQuery, categorySlug: oth.slug, pageSize: 50 }, { db })).items.map((i) => i.id)).toEqual([ids.product]);
    expect((await searchProducts({ ...baseQuery, categorySlug: sub.slug, pageSize: 50 }, { db })).total).toBe(0);
    // возвращаем в «Триммеры» для следующих сценариев
    await productOps.update(admin, ids.product!, edit(ids.sub!), opts());
    expect((await searchProducts({ ...baseQuery, categorySlug: sub.slug, pageSize: 50 }, { db })).total).toBe(1);
  });

  it('6. SEO и вкладка «Дополнительно» категории сохраняются и видны после перезагрузки', () => {
    categoryOps.updateSeo(
      admin,
      ids.sub!,
      { seoTitle: 'Триммеры — купить', seoDescription: 'Каталог триммеров', h1: 'Триммеры для сада', seoText: 'Текст', slug: 'trimmery-sada', canonical: '', indexable: true } as never,
      opts(),
    );
    categoryOps.updateExtra(admin, ids.sub!, { showInMenu: false, showOnHome: true, showInCatalog: true, sort: 5, priority: 2, code: 'trim', externalRef: '1C-77', adminComment: 'проверено', relatedIds: [ids.cat!] } as never, opts());
    reopen();
    expect(categoriesRepo.findById(db, ids.sub!)).toMatchObject({ slug: 'trimmery-sada', seoTitle: 'Триммеры — купить', h1: 'Триммеры для сада', showInMenu: false, code: 'trim' });
    expect(audit.list({ entity: 'category' }, { db }).length).toBeGreaterThanOrEqual(4);
  });

  it('5. скрытие категории: товар и адреса пропали с витрины, состояние переживает перезагрузку, показ возвращает', async () => {
    const urls = () => listSitemapEntries({ db, siteUrl: 'https://shop.example.ru' }).map((e) => e.url);
    const slug = categoriesRepo.findById(db, ids.sub!)!.slug;
    const product = productOps.get(admin, ids.product!, opts())!;
    expect(await getProductBySlug(product.slug, { db })).not.toBeNull();
    expect(urls()).toContain(`https://shop.example.ru/product/${product.slug}`);

    categoryVisibilityOps.setHidden(admin, ids.sub!, true, opts());
    reopen();
    expect(await getCategoryBySlug(slug, { db })).toBeNull();
    expect(await getProductBySlug(product.slug, { db })).toBeNull();
    expect((await searchProducts({ ...baseQuery, text: 'Champion', pageSize: 20 }, { db })).total).toBe(0);
    expect(urls().some((u) => u.includes(product.slug) || u.endsWith(`/catalog/${slug}`))).toBe(false);

    categoryVisibilityOps.setHidden(admin, ids.sub!, false, opts());
    reopen();
    expect(await getProductBySlug(product.slug, { db })).not.toBeNull();
    expect(urls()).toContain(`https://shop.example.ru/product/${product.slug}`);
  });

  it('7. настройки магазина: название, телефон и «показывать цены» применяются на витрине и в шлюзе', async () => {
    const v = getStoreSettings(admin, { db, mailConfigured: true });
    await saveStoreSettings(admin, { ...v, storeName: 'Мой Сад', phone: '+7 900 000-11-22', flags: { ...v.flags, showPrices: false } }, { db, now: T, mailConfigured: true });
    reopen();
    const info = getShopInfo({ db });
    expect(info.siteName).toBe('Мой Сад');
    expect(info.phone).toContain('900');
    expect(getStoreFlags({ db, now: T + 60_000 }).showPrices).toBe(false);
    expect(decideStoreGate({ pathname: '/cart', isStaff: () => false }, { db, now: T + 60_000 })).toMatchObject({ kind: 'page', status: 403, reason: 'prices_hidden' });
    expect(decideStoreGate({ pathname: '/api/cart/items', isStaff: () => false }, { db, now: T + 60_000 })).toMatchObject({ kind: 'json', status: 403 });
    // возврат
    const again = getStoreSettings(admin, { db, mailConfigured: true });
    await saveStoreSettings(admin, { ...again, flags: { ...again.flags, showPrices: true } }, { db, now: T, mailConfigured: true });
    expect(decideStoreGate({ pathname: '/cart', isStaff: () => false }, { db, now: T + 120_000 }).kind).toBe('pass');
  });

  it('8. заказ гостя: подтверждён → собирается → передан → выполнен, возврат на шаг назад, история', async () => {
    const { order } = await placeGuestOrder(db, ids.product!);
    ids.order = order.id;
    ids.orderNumber = order.number;
    expect(order.status).toBe('new');
    for (const to of ['confirmed', 'processing', 'shipped'] as const) expect((await orderOps.changeStatus(admin, order.id, to, undefined, opts())).status).toBe(to);
    expect((await orderOps.revert(admin, order.id, 'processing', 'Передали по ошибке', opts())).status).toBe('processing');
    for (const to of ['shipped', 'delivered'] as const) expect((await orderOps.changeStatus(admin, order.id, to, undefined, opts())).status).toBe(to);
    // недопустимый переход отклоняется, статус не меняется
    await expect(orderOps.changeStatus(admin, order.id, 'new', undefined, opts())).rejects.toThrow();
    expect(orderOps.get(admin, order.number, opts())?.status).toBe('delivered');
    const history = orderOps.history(admin, order.id, opts());
    expect(history.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(history)).toContain('Передали по ошибке');
    reopen();
    expect(orderOps.get(admin, order.number, opts())?.status).toBe('delivered');
  });

  it('9. импорт CSV: сопоставление колонок, предпросмотр ничего не пишет, подтверждение создаёт товары', async () => {
    addCategory(db, 'Инструмент', 'instrument');
    const o = { ...opts(), stagingDir };
    const up = importOps.upload(admin, { fileName: 'price.csv', content: utf8(csv([['Код', 'Наименование', 'Стоимость', 'Раздел'], ['CSV-1', 'Секатор садовый', '1200', 'Инструмент'], ['CSV-2', 'Ножовка', '800', 'Инструмент']])) }, o);
    importOps.saveMapping(admin, up.runId, ['sku', 'name', 'price', 'category'], o);
    expect(importOps.state(admin, up.runId, o).settings.mapping).toEqual({ Код: 'sku', Наименование: 'name', Стоимость: 'price', Раздел: 'category' });
    const before = count('products');
    const preview = importOps.analyze(admin, up.runId, o);
    expect(JSON.stringify(preview)).toContain('Секатор');
    expect(count('products')).toBe(before); // предпросмотр БД не меняет
    await importOps.apply(admin, up.runId, { confirmOverride: true }, o).done;
    expect(count('products')).toBe(before + 2);
    const row = db.prepare("SELECT price_kopecks AS p FROM products WHERE sku = 'CSV-1'").get() as { p: number };
    expect(row.p).toBe(120_000);
  });

  it('10. пользователь без права: запрещённая операция → 403 и БД не меняется; роль с урезанными правами действует', async () => {
    const roleId = rolesService.create(admin, { name: 'Только заказы', permissions: ['orders.read', 'products.read'] }, { db, now: T });
    const created = await createStaff({ email: 'orders-only', password: 'orders-only-pass-1', role: roleId.code }, { db, now: T });
    const jar = fakeCookies();
    await loginStaff({ email: 'orders-only', password: 'orders-only-pass-1' }, { db, cookies: jar, ip: '10.0.0.3', now: T });
    const limited = getStaffSession(jar, { db, now: T })!;
    expect(limited.staffId).toBe(created.staffId);

    const snapshot = { products: count('products'), categories: count('categories'), audit: count('audit_log'), roles: count('roles'), settings: count('shop_settings') };
    const p = productOps.get(admin, ids.product!, opts())!;
    await expect(productOps.create(limited, { name: 'Запрещено', categoryId: ids.sub!, priceKopecks: 100 }, opts())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(productOps.update(limited, p.id, { name: 'Взлом', categoryId: ids.sub!, priceKopecks: 1 }, opts())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(productOps.remove(limited, p.id, opts())).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => categoryVisibilityOps.setHidden(limited, ids.sub!, true, opts())).toThrow(ForbiddenError);
    expect(() => categoryOps.create(limited, { name: 'Левая', parentId: null }, opts())).toThrow(ForbiddenError);
    expect(() => rolesService.create(limited, { name: 'Хакер', permissions: ['roles.manage'] }, { db, now: T })).toThrow(ForbiddenError);
    await expect(saveStoreSettings(limited, { ...getStoreSettings(admin, { db, mailConfigured: true }), storeName: 'Взлом' }, { db, now: T, mailConfigured: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(orderOps.changeStatus(limited, ids.order!, 'cancelled', undefined, opts())).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => importOps.upload(limited, { fileName: 'x.csv', content: utf8('a;b\r\n1;2\r\n') }, { ...opts(), stagingDir })).toThrow(ForbiddenError);
    expect(() => productOps.get(null, p.id, opts())).toThrow(UnauthorizedError);
    expect({ products: count('products'), categories: count('categories'), audit: count('audit_log'), roles: count('roles'), settings: count('shop_settings') }).toEqual(snapshot);
    expect(productOps.get(admin, p.id, opts())?.name).toBe('Триммер бензиновый Champion T523');

    // разрешённое этой роли — читает заказ и товар
    expect(orderOps.get(limited, ids.orderNumber!, opts())?.number).toBe(ids.orderNumber);
    expect(productOps.get(limited, p.id, opts())?.id).toBe(p.id);

    // снятие права действует на открытую сессию со следующего запроса
    rolesService.setPermissions(admin, roleId.roleId, ['products.read'], { db, now: T });
    const after = getStaffSession(jar, { db, now: T })!;
    expect(() => orderOps.get(after, ids.orderNumber!, opts())).toThrow(ForbiddenError);
  });

  it('проверка входа (zod) не пропускает мусор: пустое название категории и товара', async () => {
    expect(() => categoryOps.create(admin, { name: '  ', parentId: null }, opts())).toThrow(ValidationError);
    await expect(productOps.create(admin, { name: '', categoryId: ids.sub!, priceKopecks: 1 }, opts())).rejects.toBeInstanceOf(ValidationError);
  });
});
