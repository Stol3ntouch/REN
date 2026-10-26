import { describe, expect, it } from 'vitest';
import { categoryOps } from '@/app/admin/(panel)/_lib/category-ops';
import { categoryBulkOps, categoryTreeOps } from '@/app/admin/(panel)/_lib/category-tree-ops';
import { categoryVisibilityOps } from '@/app/admin/(panel)/catalog/category-visibility-ops';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { getCategoryTree } from '@/domain/catalog/categories';
import { getFacets } from '@/domain/catalog/facets';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { categoryLinksRepo } from '@/server/db/repositories/category-links';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { ymlXml } from '../importing/helpers';
import { addCategory, addProduct } from '../catalog/helpers';
import { admin, importXml, manager, T0 } from './helpers';

const o = (db: Db) => ({ db, now: T0 });
const content: StaffSession = { staffId: 5, email: 'c@shop.test', name: 'Контент', role: 'content_manager' };

/** Садовая техника → Триммеры → Бензиновые; рядом корневые «Насосы» и «Пилы». */
function shop() {
  const db = createTestDb();
  const sad = addCategory(db, 'Садовая техника', 'sad');
  const trim = addCategory(db, 'Триммеры', 'trimmery', sad);
  const benzo = addCategory(db, 'Бензиновые триммеры', 'benzo', trim);
  const pumps = addCategory(db, 'Насосы', 'nasosy');
  const saws = addCategory(db, 'Пилы', 'pily');
  const p1 = addProduct(db, { name: 'Триммер 1', categoryId: trim });
  const p2 = addProduct(db, { name: 'Триммер 2', categoryId: trim });
  const p3 = addProduct(db, { name: 'Бензотриммер', categoryId: benzo });
  const unpublished = addProduct(db, { name: 'Черновик', categoryId: benzo, published: false });
  const pump = addProduct(db, { name: 'Насос', categoryId: pumps });
  return { db, sad, trim, benzo, pumps, saws, p1, p2, p3, unpublished, pump };
}

describe('дерево категорий: уровни, счётчики, поиск', () => {
  it('корень и дети по уровням; счётчик — различные опубликованные товары поддерева; hasChildren', () => {
    const { db, sad, trim, benzo, pumps } = shop();
    const roots = categoryTreeOps.children(admin, null, { db });
    expect(roots.nodes.map((n) => [n.id, n.hasChildren, n.productCount])).toEqual([
      [sad, true, 3],
      [pumps, false, 1],
      [expect.any(Number), false, 0],
    ]);
    expect(roots.total).toBe(4);
    const level2 = categoryTreeOps.children(admin, sad, { db });
    expect(level2.nodes).toHaveLength(1);
    expect(level2.nodes[0]).toMatchObject({ id: trim, hasChildren: true, productCount: 3 });
    expect(categoryTreeOps.children(admin, trim, { db }).nodes[0]).toMatchObject({ id: benzo, productCount: 1 });
  });

  it('товар в двух категориях считается в общем родителе один раз', () => {
    const { db, sad, trim, p1, pumps } = shop();
    db.prepare('INSERT INTO product_categories (product_id, category_id, is_primary, sort) VALUES (?, ?, 0, 1)').run(p1, sad);
    expect(categoryTreeOps.children(admin, null, { db }).nodes.find((n) => n.id === sad)?.productCount).toBe(3);
    db.prepare('INSERT INTO product_categories (product_id, category_id, is_primary, sort) VALUES (?, ?, 0, 1)').run(p1, pumps);
    expect(categoryTreeOps.children(admin, null, { db }).nodes.find((n) => n.id === pumps)?.productCount).toBe(2);
    expect(trim).toBeGreaterThan(0);
  });

  it('скрытые и неактивные видны в админке и помечены; неизвестный родитель — 404; чтение менеджеру можно, без сессии — 401', () => {
    const { db, trim, benzo } = shop();
    categoryVisibilityOps.setHidden(admin, trim, true, o(db));
    const kids = categoryTreeOps.children(manager, trim, { db }).nodes;
    expect(kids[0]).toMatchObject({ id: benzo, hidden: false, effectiveHidden: true });
    expect(() => categoryTreeOps.children(admin, 9999, { db })).toThrow(NotFoundError);
    expect(() => categoryTreeOps.children(null, null, { db })).toThrow(UnauthorizedError);
    expect(() => categoryTreeOps.children(admin, 'x', { db })).toThrow(ValidationError);
  });

  it('поиск по названию без учёта регистра возвращает путь; пустой запрос — пусто', () => {
    const { db, benzo } = shop();
    expect(categoryTreeOps.search(admin, 'БЕНЗИН', { db })).toEqual([{ id: benzo, name: 'Бензиновые триммеры', path: 'Садовая техника › Триммеры › Бензиновые триммеры', parentId: expect.any(Number), effectiveHidden: false }]);
    expect(categoryTreeOps.search(admin, '   ', { db })).toEqual([]);
    expect(categoryTreeOps.search(admin, 'нет такой', { db })).toEqual([]);
  });

  it('путь до выбранной категории — цепочка предков', () => {
    const { db, sad, trim, benzo } = shop();
    expect(categoryTreeOps.path(admin, benzo, { db })).toEqual([sad, trim, benzo]);
    expect(() => categoryTreeOps.path(admin, 9999, { db })).toThrow(NotFoundError);
  });

  it('185 категорий читаются одним запросом на уровень (корни — без обхода по дереву)', () => {
    const db = createTestDb();
    for (let i = 0; i < 185; i++) addCategory(db, `Категория ${i}`, `cat-${i}`, i % 10 === 0 || i < 10 ? null : null);
    expect(categoryTreeOps.children(admin, null, { db }).nodes).toHaveLength(185);
  });
});

describe('перенос и порядок', () => {
  it('перенос в себя и в потомков запрещён (цикл), данные не меняются', () => {
    const { db, sad, trim, benzo } = shop();
    expect(() => categoryTreeOps.place(admin, sad, { parentId: sad }, o(db))).toThrow(ValidationError);
    expect(() => categoryTreeOps.place(admin, sad, { parentId: benzo }, o(db))).toThrow(ValidationError);
    expect(() => categoryTreeOps.place(admin, trim, { parentId: benzo }, o(db))).toThrow(/в саму себя или в её подкатегорию/);
    expect(categoriesRepo.findById(db, sad)?.parentId).toBeNull();
    expect(audit.list({ entity: 'category' }, { db })).toEqual([]);
  });

  it('перенос под другого родителя: родитель, порядок среди новых соседей, аудит category.move, закрепление родителя', () => {
    const { db, trim, pumps, saws } = shop();
    expect(categoryTreeOps.place(admin, saws, { parentId: pumps }, o(db))).toEqual({ changed: true });
    expect(categoriesRepo.findById(db, saws)).toMatchObject({ parentId: pumps, lockedParent: true, lockedName: false });
    const [rec] = audit.list({ action: 'category.move' }, { db });
    expect(rec).toMatchObject({ entity: 'category', entityId: String(saws), before: { parentId: null }, after: { parentId: pumps } });
    expect(() => categoryTreeOps.place(admin, trim, { parentId: 9999 }, o(db))).toThrow(NotFoundError);
    expect(() => categoryTreeOps.place(admin, 9999, { parentId: null }, o(db))).toThrow(NotFoundError);
  });

  it('перенос под скрытого родителя скрывает категорию для покупателя (effective_hidden пересчитан)', () => {
    const { db, pumps, saws } = shop();
    categoryVisibilityOps.setHidden(admin, pumps, true, o(db));
    categoryTreeOps.place(admin, saws, { parentId: pumps }, o(db));
    expect(categoriesRepo.findById(db, saws)?.effectiveHidden).toBe(true);
    categoryTreeOps.place(admin, saws, { parentId: null }, o(db));
    expect(categoriesRepo.findById(db, saws)?.effectiveHidden).toBe(false);
  });

  it('порядок: «перед соседом» и «в конец»; «выше/ниже» — клавиатурный запасной вариант; крайние позиции без изменений', () => {
    const { db, sad, pumps, saws } = shop();
    const order = () => categoryTreeOps.children(admin, null, { db }).nodes.map((n) => n.id);
    expect(order()).toEqual([sad, pumps, saws]);
    expect(categoryTreeOps.place(admin, saws, { parentId: null, beforeId: sad }, o(db))).toEqual({ changed: true });
    expect(order()).toEqual([saws, sad, pumps]);
    expect(audit.list({ action: 'category.reorder' }, { db })).toHaveLength(1);
    expect(categoryTreeOps.step(admin, saws, 'down', o(db))).toEqual({ changed: true });
    expect(order()).toEqual([sad, saws, pumps]);
    expect(categoryTreeOps.step(admin, pumps, 'down', o(db))).toEqual({ changed: false });
    expect(categoryTreeOps.step(admin, sad, 'up', o(db))).toEqual({ changed: false });
    expect(categoryTreeOps.step(admin, pumps, 'up', o(db))).toEqual({ changed: true });
    expect(order()).toEqual([sad, pumps, saws]);
    expect(categoryTreeOps.place(admin, sad, { parentId: null }, o(db))).toEqual({ changed: true });
    expect(order()).toEqual([pumps, saws, sad]);
    expect(() => categoryTreeOps.step(admin, sad, 'left', o(db))).toThrow(ValidationError);
  });

  it('сосед должен быть в том же родителе; повтор того же положения — без изменений и без аудита', () => {
    const { db, sad, trim, pumps } = shop();
    expect(() => categoryTreeOps.place(admin, pumps, { parentId: null, beforeId: trim }, o(db))).toThrow(ValidationError);
    expect(categoryTreeOps.place(admin, sad, { parentId: null, beforeId: pumps }, o(db))).toEqual({ changed: false });
    expect(audit.list({ entity: 'category' }, { db })).toEqual([]);
  });

  it('права: менеджер и контент-менеджер без categories.write получают 403', () => {
    const { db, sad } = shop();
    expect(() => categoryTreeOps.place(manager, sad, { parentId: null }, o(db))).toThrow(ForbiddenError);
    expect(() => categoryTreeOps.step(content, sad, 'down', o(db))).toThrow(ForbiddenError);
    expect(() => categoryTreeOps.place(null, sad, { parentId: null }, o(db))).toThrow(UnauthorizedError);
  });
});

describe('глаз: сохраняется на сервере, каскад, товары остаются', () => {
  it('скрытие переживает «перезагрузку» (повторное чтение из БД), дети — effective_hidden, товары не удаляются', () => {
    const { db, trim, benzo } = shop();
    categoryVisibilityOps.setHidden(admin, trim, true, o(db));
    const again = categoryTreeOps.children(admin, null, { db });
    expect(again.nodes.length).toBeGreaterThan(0);
    expect(categoryTreeOps.children(admin, trim, { db }).nodes[0]).toMatchObject({ id: benzo, effectiveHidden: true, hidden: false });
    expect(db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 5 });
    expect(categoryTreeOps.search(admin, 'Триммеры', { db })[0]).toMatchObject({ effectiveHidden: true });
  });

  it('менеджер не может скрыть (403): права categories.write', () => {
    const { db, trim } = shop();
    expect(() => categoryVisibilityOps.setHidden(manager, trim, true, o(db))).toThrow(ForbiddenError);
  });
});

describe('карточка: создание, правка, удаление', () => {
  it('создание корневой и дочерней: slug из названия (уникальный), системный код, позиция в конец, аудит category.create', () => {
    const { db, sad } = shop();
    const a = categoryOps.create(admin, { name: 'Садовые тачки', parentId: null }, o(db));
    const b = categoryOps.create(admin, { name: 'Садовые тачки', parentId: sad }, o(db));
    const rowA = categoriesRepo.findById(db, a.id)!;
    const rowB = categoriesRepo.findById(db, b.id)!;
    expect(rowA).toMatchObject({ source: 'admin', parentId: null, slug: 'sadovye-tachki', code: `cat_${a.id}`, active: true, showInMenu: true, showOnHome: true, showInCatalog: true });
    expect(rowB).toMatchObject({ parentId: sad, slug: 'sadovye-tachki-2' });
    expect(rowA.sort).toBeGreaterThan(5);
    expect(audit.list({ action: 'category.create' }, { db })).toHaveLength(2);
  });

  it('создание: проверка входа, неизвестный родитель, занятый slug, права', () => {
    const { db, sad } = shop();
    expect(() => categoryOps.create(admin, { name: '  ', parentId: null }, o(db))).toThrow(ValidationError);
    expect(() => categoryOps.create(admin, { name: 'X', parentId: 9999 }, o(db))).toThrow(ValidationError);
    expect(() => categoryOps.create(admin, { name: 'X', parentId: null, slug: 'sad' }, o(db))).toThrow(ConflictError);
    expect(() => categoryOps.create(admin, { name: 'X', parentId: null, slug: 'Плохой slug' }, o(db))).toThrow(ValidationError);
    expect(() => categoryOps.create(admin, { name: 'X', parentId: sad, extra: 1 } as never, o(db))).toThrow(ValidationError);
    expect(() => categoryOps.create(manager, { name: 'X', parentId: null }, o(db))).toThrow(ForbiddenError);
    expect(() => categoryOps.create(null, { name: 'X', parentId: null }, o(db))).toThrow(UnauthorizedError);
  });

  it('шапка: название, slug, описание, активность, позиция, родитель; аудит с до/после; повтор без изменений — без аудита', async () => {
    const { db, trim, pumps } = shop();
    const head = { name: 'Триммеры и косы', slug: 'trimmery-i-kosy', description: 'Описание', active: true, sort: 7, parentId: pumps };
    expect((await categoryOps.updateHeader(admin, trim, head, undefined, o(db))).changed.sort()).toEqual(['description', 'name', 'parentId', 'slug', 'sort']);
    expect(categoriesRepo.findById(db, trim)).toMatchObject({ name: 'Триммеры и косы', slug: 'trimmery-i-kosy', description: 'Описание', sort: 7, parentId: pumps, lockedName: true, lockedParent: true });
    const [rec] = audit.list({ action: 'category.update', entityId: String(trim) }, { db });
    expect(rec!.before).toMatchObject({ name: 'Триммеры', slug: 'trimmery' });
    expect(rec!.after).toMatchObject({ name: 'Триммеры и косы', slug: 'trimmery-i-kosy' });
    expect((await categoryOps.updateHeader(admin, trim, head, undefined, o(db))).changed).toEqual([]);
    expect(audit.list({ action: 'category.update' }, { db })).toHaveLength(1);
  });

  it('шапка: родитель — не потомок; slug уникален; чужой id — 404; пустой slug оставляет прежний; права', async () => {
    const { db, sad, trim, benzo, pumps } = shop();
    const head = (over: Record<string, unknown> = {}) => ({ name: 'Триммеры', slug: 'trimmery', description: '', active: true, sort: 1, parentId: sad, ...over });
    await expect(categoryOps.updateHeader(admin, sad, head({ name: 'Садовая техника', slug: 'sad', parentId: benzo }), undefined, o(db))).rejects.toThrow(ValidationError);
    await expect(categoryOps.updateHeader(admin, trim, head({ slug: 'nasosy' }), undefined, o(db))).rejects.toThrow(ConflictError);
    await expect(categoryOps.updateHeader(admin, 9999, head(), undefined, o(db))).rejects.toThrow(NotFoundError);
    await expect(categoryOps.updateHeader(manager, trim, head(), undefined, o(db))).rejects.toThrow(ForbiddenError);
    await categoryOps.updateHeader(admin, pumps, head({ name: 'Насосы', slug: '', parentId: null }), undefined, o(db));
    expect(categoriesRepo.findById(db, pumps)?.slug).toBe('nasosy');
  });

  it('«Активная»: выключение скрывает категорию и подкатегории на сайте, включение возвращает; глаз при этом не меняется', async () => {
    const { db, sad, trim, benzo } = shop();
    const head = { name: 'Садовая техника', slug: 'sad', description: '', active: false, sort: 1, parentId: null };
    await categoryOps.updateHeader(admin, sad, head, undefined, o(db));
    expect(categoriesRepo.findById(db, sad)).toMatchObject({ active: false, hiddenByAdmin: false, effectiveHidden: true });
    expect(categoriesRepo.findById(db, benzo)?.effectiveHidden).toBe(true);
    expect(categoriesRepo.findVisibleBySlug(db, 'trimmery')).toBeUndefined();
    await categoryOps.updateHeader(admin, sad, { ...head, active: true }, undefined, o(db));
    expect(categoriesRepo.findById(db, trim)?.effectiveHidden).toBe(false);
  });

  it('удаление: запрещено при товарах и подкатегориях (с подсказкой), пустую категорию можно; аудит category.delete', () => {
    const { db, sad, benzo, saws } = shop();
    expect(() => categoryOps.remove(admin, sad, o(db))).toThrow(/подкатегорий/);
    expect(() => categoryOps.remove(admin, benzo, o(db))).toThrow(/товаров/);
    expect(() => categoryOps.remove(admin, benzo, o(db))).toThrow(/скройте/);
    expect(() => categoryOps.remove(manager, saws, o(db))).toThrow(ForbiddenError);
    expect(() => categoryOps.remove(admin, 9999, o(db))).toThrow(NotFoundError);
    categoryOps.remove(admin, saws, o(db));
    expect(categoriesRepo.findById(db, saws)).toBeUndefined();
    expect(audit.list({ action: 'category.delete' }, { db })).toHaveLength(1);
  });

  it('карточка: путь, счётчики, список родителей без себя и потомков; менеджер читает', () => {
    const { db, sad, trim, benzo } = shop();
    const card = categoryOps.get(manager, trim, { db })!;
    expect(card.path.map((p) => p.id)).toEqual([sad, trim]);
    expect(card).toMatchObject({ childCount: 1, productCount: 2, liveProductCount: 3, imageUrl: null });
    expect(categoryOps.get(admin, 9999, { db })).toBeNull();
    const parents = categoryOps.parentOptions(admin, trim, { db }).map((p) => p.id);
    expect(parents).not.toContain(trim);
    expect(parents).not.toContain(benzo);
    expect(parents).toContain(sad);
  });

  it('изображение: не картинка отвергается по содержимому, а не по расширению', async () => {
    const { db, trim } = shop();
    const head = { name: 'Триммеры', slug: 'trimmery', description: '', active: true, sort: 1, parentId: categoriesRepo.findById(db, trim)!.parentId };
    await expect(categoryOps.updateHeader(admin, trim, head, { bytes: new TextEncoder().encode('<html>не картинка</html>') }, o(db))).rejects.toThrow(/не является изображением/);
    await expect(categoryOps.updateHeader(admin, trim, head, { bytes: new Uint8Array(0) }, o(db))).rejects.toThrow(ValidationError);
    await expect(categoryOps.updateHeader(admin, trim, head, { bytes: new Uint8Array(5 * 1024 * 1024 + 1) }, o(db))).rejects.toThrow(/5 МБ/);
  });
});

describe('«Дополнительно»: флаги, сортировка, связи, служебные поля', () => {
  const extra = (over: Record<string, unknown> = {}) => ({ showInMenu: true, showOnHome: true, showInCatalog: true, sort: 1, priority: 0, code: 'SAD_TEHNIKA', externalRef: 'ext_12', adminComment: 'Комментарий', relatedIds: [] as number[], ...over });

  it('три флага показа независимы друг от друга и от глаза; сохраняются и пишутся в аудит', () => {
    const { db, sad } = shop();
    categoryOps.updateExtra(admin, sad, extra({ showInMenu: false }), o(db));
    expect(categoriesRepo.findById(db, sad)).toMatchObject({ showInMenu: false, showOnHome: true, showInCatalog: true, hiddenByAdmin: false, effectiveHidden: false, code: 'SAD_TEHNIKA', externalRef: 'ext_12', adminComment: 'Комментарий' });
    categoryOps.updateExtra(admin, sad, extra({ showInMenu: false, showOnHome: false, showInCatalog: false }), o(db));
    expect(categoriesRepo.findById(db, sad)).toMatchObject({ showInMenu: false, showOnHome: false, showInCatalog: false, hiddenByAdmin: false });
    const recs = audit.list({ action: 'category.update', entityId: String(sad) }, { db });
    expect(recs).toHaveLength(2);
    expect(recs[0]!.after).toMatchObject({ showOnHome: false, showInCatalog: false });
  });

  it('код категории уникален; пустой код заменяется системным; неверные символы отвергаются', () => {
    const { db, sad, pumps } = shop();
    categoryOps.updateExtra(admin, sad, extra(), o(db));
    expect(() => categoryOps.updateExtra(admin, pumps, extra(), o(db))).toThrow(ConflictError);
    expect(() => categoryOps.updateExtra(admin, pumps, extra({ code: 'плохой код' }), o(db))).toThrow(ValidationError);
    categoryOps.updateExtra(admin, pumps, extra({ code: '' }), o(db));
    expect(categoriesRepo.findById(db, pumps)?.code).toBe(`cat_${pumps}`);
  });

  it('приоритет: чем меньше, тем выше категория (после позиции в порядке показа)', () => {
    const { db, sad, pumps, saws } = shop();
    categoryOps.updateExtra(admin, saws, extra({ code: 'SAWS', priority: -1, sort: 99 }), o(db));
    expect(categoriesRepo.listAll(db).filter((c) => c.parentId === null).map((c) => c.id)).toEqual([saws, sad, pumps]);
  });

  it('связанные категории: дубли схлопываются, связь с собой запрещена, несуществующая — ошибка, удаление связи; в таблице пара уникальна', () => {
    const { db, sad, pumps, saws } = shop();
    categoryOps.updateExtra(admin, sad, extra({ relatedIds: [pumps, saws, pumps] }), o(db));
    expect(categoryLinksRepo.listRelated(db, sad).map((r) => r.id)).toEqual([pumps, saws]);
    expect(() => categoryOps.updateExtra(admin, sad, extra({ relatedIds: [sad] }), o(db))).toThrow(/с самой собой/);
    expect(() => categoryOps.updateExtra(admin, sad, extra({ relatedIds: [9999] }), o(db))).toThrow(ValidationError);
    expect(() => db.prepare('INSERT INTO category_related (category_id, related_id, sort) VALUES (?, ?, 0)').run(sad, pumps)).toThrow();
    expect(() => db.prepare('INSERT INTO category_related (category_id, related_id, sort) VALUES (?, ?, 0)').run(sad, sad)).toThrow();
    categoryOps.updateExtra(admin, sad, extra({ relatedIds: [saws] }), o(db));
    expect(categoryLinksRepo.listRelated(db, sad).map((r) => r.id)).toEqual([saws]);
    expect(audit.list({ action: 'category.update', entityId: String(sad) }, { db }).at(0)!.after).toMatchObject({ relatedIds: [saws] });
  });

  it('связи удаляются вместе с категорией; скрытая связанная не показывается покупателю', () => {
    const { db, sad, pumps, saws } = shop();
    categoryOps.updateExtra(admin, sad, extra({ relatedIds: [pumps, saws] }), o(db));
    categoryVisibilityOps.setHidden(admin, pumps, true, o(db));
    expect(categoryLinksRepo.listRelatedVisible(db, sad).map((r) => r.id)).toEqual([saws]);
    categoryOps.remove(admin, saws, o(db));
    expect(categoryLinksRepo.listRelated(db, sad).map((r) => r.id)).toEqual([pumps]);
  });

  it('права и проверка входа: менеджер — 403, отрицательные и дробные числа — ошибка, неизвестные поля — ошибка', () => {
    const { db, sad } = shop();
    expect(() => categoryOps.updateExtra(manager, sad, extra(), o(db))).toThrow(ForbiddenError);
    expect(() => categoryOps.updateExtra(admin, sad, extra({ priority: 1.5 }), o(db))).toThrow(ValidationError);
    expect(() => categoryOps.updateExtra(admin, sad, extra({ unknown: 1 }), o(db))).toThrow(ValidationError);
    expect(() => categoryOps.updateExtra(admin, 9999, extra(), o(db))).toThrow(NotFoundError);
    expect(() => categoryOps.updateExtra(admin, sad, extra({ adminComment: 'я'.repeat(2001) }), o(db))).toThrow(ValidationError);
  });
});

describe('SEO категории: slug, canonical, индексация', () => {
  const seo = (over: Record<string, unknown> = {}) => ({ seoTitle: 'Заголовок', seoDescription: 'Описание', h1: '', seoText: '', slug: '', canonical: '', indexable: true, ...over });

  it('сохраняет поля, slug уникален, canonical — http(s) или путь, noindex сохраняется; аудит category.seo', () => {
    const { db, trim } = shop();
    categoryOps.updateSeo(admin, trim, seo({ slug: 'trimmery-new', canonical: 'https://shop.example.ru/catalog/trimmery-new', indexable: false }), o(db));
    expect(categoriesRepo.findById(db, trim)).toMatchObject({ slug: 'trimmery-new', canonical: 'https://shop.example.ru/catalog/trimmery-new', indexable: false, seoTitle: 'Заголовок' });
    categoryOps.updateSeo(admin, trim, seo({ slug: 'trimmery-new', canonical: '/catalog/trimmery-new', indexable: true }), o(db));
    expect(categoriesRepo.findById(db, trim)?.canonical).toBe('/catalog/trimmery-new');
    expect(() => categoryOps.updateSeo(admin, trim, seo({ slug: 'sad' }), o(db))).toThrow(ConflictError);
    expect(() => categoryOps.updateSeo(admin, trim, seo({ canonical: 'javascript:alert(1)' }), o(db))).toThrow(ValidationError);
    expect(() => categoryOps.updateSeo(admin, trim, seo({ canonical: '//evil.example' }), o(db))).toThrow(ValidationError);
    expect(audit.list({ action: 'category.seo' }, { db })).toHaveLength(2);
    expect(() => categoryOps.updateSeo(manager, trim, seo(), o(db))).toThrow(ForbiddenError);
    expect(() => categoryOps.updateSeo(admin, 9999, seo(), o(db))).toThrow(NotFoundError);
  });
});

describe('фильтры категории: порядок и показ поверх общих фильтров', () => {
  function filtered() {
    const s = shop();
    for (const p of [s.p1, s.p2, s.p3]) db_attrs(s.db, p);
    return s;
  }
  function db_attrs(db: Db, productId: number) {
    db.prepare('INSERT OR IGNORE INTO attribute_definitions (name, type, filterable) VALUES (?, ?, 1)').run('Мощность', 'string');
    const a = db.prepare('SELECT id FROM attribute_definitions WHERE name = ?').get('Мощность') as { id: number };
    db.prepare('INSERT INTO product_attributes (product_id, attribute_id, value) VALUES (?, ?, ?)').run(productId, a.id, '1000 Вт');
  }

  it('отключение фильтра в категории скрывает его там и в подкатегориях, но не в других; порядок переопределяется', async () => {
    const { db, trim, benzo, pumps } = filtered();
    const price = (db.prepare("SELECT id FROM catalog_filters WHERE kind = 'price'").get() as { id: number }).id;
    const stock = (db.prepare("SELECT id FROM catalog_filters WHERE kind = 'stock'").get() as { id: number }).id;
    const names = async (cat: number) => (await getFacets(cat, { filters: {} }, { db })).map((f) => f.kind);
    const before = await names(trim);
    expect(before).toContain('price');
    const rows = categoryOps.filters(admin, trim, { db });
    expect(rows.map((r) => r.filterId)).toContain(price);
    categoryOps.saveFilters(admin, trim, [{ filterId: price, enabled: false, sort: null }, { filterId: stock, enabled: true, sort: 1 }], o(db));
    expect(await names(trim)).not.toContain('price');
    expect(await names(benzo)).not.toContain('price');
    expect((await names(trim))[0]).toBe('stock');
    // в другой категории фильтры прежние
    expect(await names(pumps)).toContain('price');
    expect(categoryOps.filters(admin, benzo, { db }).find((r) => r.filterId === price)).toMatchObject({ enabled: true, inheritedOff: true });
    // подкатегория может вернуть фильтр своей настройкой
    categoryOps.saveFilters(admin, benzo, [{ filterId: price, enabled: true, sort: 5 }], o(db));
    expect(await names(benzo)).toContain('price');
    expect(audit.list({ action: 'category.filters' }, { db })).toHaveLength(2);
  });

  it('строки «по умолчанию» не хранятся, повтор — без изменений; неизвестный фильтр и чужая категория — ошибка; права', () => {
    const { db, trim } = filtered();
    const price = (db.prepare("SELECT id FROM catalog_filters WHERE kind = 'price'").get() as { id: number }).id;
    expect(categoryOps.saveFilters(admin, trim, [{ filterId: price, enabled: true, sort: null }], o(db))).toEqual({ changed: false });
    expect(db.prepare('SELECT COUNT(*) AS n FROM category_filter_settings').get()).toEqual({ n: 0 });
    expect(() => categoryOps.saveFilters(admin, trim, [{ filterId: 99999, enabled: false, sort: null }], o(db))).toThrow(ValidationError);
    expect(() => categoryOps.saveFilters(admin, 9999, [], o(db))).toThrow(NotFoundError);
    expect(() => categoryOps.saveFilters(manager, trim, [], o(db))).toThrow(ForbiddenError);
  });
});

describe('баннеры категории: привязка, порядок, статус, удаление связи', () => {
  function withBanners() {
    const s = shop();
    const ins = s.db.prepare("INSERT INTO banners (title, position, status, created_at, updated_at) VALUES (?, ?, 'active', 0, 0)");
    const a = Number(ins.run('Баннер А', 'category').lastInsertRowid);
    const b = Number(ins.run('Баннер Б', 'category').lastInsertRowid);
    const hero = Number(ins.run('Главный', 'home_hero').lastInsertRowid);
    return { ...s, a, b, hero };
  }

  it('привязка только баннеров позиции «category»; повтор не создаёт дубль; порядок и статус; удаление убирает связь, а не баннер', () => {
    const { db, trim, a, b, hero } = withBanners();
    expect(categoryOps.banners(admin, trim, { db }).choices.map((c) => c.id)).toEqual([a, b]);
    expect(categoryOps.addBanner(admin, trim, a, o(db))).toEqual({ added: true });
    expect(categoryOps.addBanner(admin, trim, a, o(db))).toEqual({ added: false });
    categoryOps.addBanner(admin, trim, b, o(db));
    expect(() => categoryOps.addBanner(admin, trim, hero, o(db))).toThrow(NotFoundError);
    expect(categoryOps.banners(admin, trim, { db }).links.map((l) => l.bannerId)).toEqual([a, b]);
    expect(categoryOps.updateBanner(admin, trim, b, { sort: -5, enabled: false }, o(db))).toEqual({ changed: true });
    expect(categoryOps.updateBanner(admin, trim, b, { sort: -5, enabled: false }, o(db))).toEqual({ changed: false });
    expect(categoryOps.banners(admin, trim, { db }).links).toMatchObject([{ bannerId: b, enabled: false, sort: -5 }, { bannerId: a }]);
    expect(categoryOps.removeBanner(admin, trim, a, o(db))).toEqual({ removed: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM banners').get()).toEqual({ n: 3 });
    expect(() => categoryOps.updateBanner(admin, trim, a, { sort: 1 }, o(db))).toThrow(NotFoundError);
    expect(audit.list({ entity: 'category' }, { db }).map((r) => r.action).sort()).toEqual(['category.banner.add', 'category.banner.add', 'category.banner.remove', 'category.banner.update']);
  });

  it('права: менеджер читает, но не меняет; чужая категория — 404', () => {
    const { db, trim, a } = withBanners();
    expect(categoryOps.banners(manager, trim, { db }).links).toEqual([]);
    expect(() => categoryOps.addBanner(manager, trim, a, o(db))).toThrow(ForbiddenError);
    expect(() => categoryOps.addBanner(admin, 9999, a, o(db))).toThrow(NotFoundError);
    expect(() => categoryOps.banners(admin, 9999, { db })).toThrow(NotFoundError);
  });
});

describe('импорт YML не сбрасывает ручные поля категорий', () => {
  it('код, флаги, комментарий, связи, скрытие, активность, закреплённые название и родитель — на месте после повторного импорта', async () => {
    const db = createTestDb();
    const xml = (name11: string) =>
      ymlXml({ categories: [`<category id="10">Генераторы</category>`, `<category id="11" parentId="10">${name11}</category>`, `<category id="12">Насосы</category>`], offers: [{ id: '1' }] });
    await importXml(db, xml('Бензиновые'));
    const c10 = categoriesRepo.findByExternalId(db, 'yml', '10')!;
    const c11 = categoriesRepo.findByExternalId(db, 'yml', '11')!;
    const c12 = categoriesRepo.findByExternalId(db, 'yml', '12')!;
    categoryOps.updateExtra(admin, c10.id, { showInMenu: false, showOnHome: false, showInCatalog: false, sort: 3, priority: 4, code: 'GEN', externalRef: 'ext', adminComment: 'не публиковать', relatedIds: [c12.id] }, o(db));
    categoryVisibilityOps.setHidden(admin, c10.id, true, o(db));
    await categoryOps.updateHeader(admin, c11.id, { name: 'Мои бензиновые', slug: c11.slug, description: 'д', active: true, sort: c11.sort, parentId: c12.id }, undefined, o(db));
    await importXml(db, xml('Бензиновые (из фида)'));
    const after10 = categoriesRepo.findById(db, c10.id)!;
    expect(after10).toMatchObject({ showInMenu: false, showOnHome: false, showInCatalog: false, priority: 4, code: 'GEN', externalRef: 'ext', adminComment: 'не публиковать', hiddenByAdmin: true });
    expect(categoryLinksRepo.listRelated(db, c10.id).map((r) => r.id)).toEqual([c12.id]);
    // название и родитель закреплены ручной правкой — фид их не возвращает
    expect(categoriesRepo.findById(db, c11.id)).toMatchObject({ name: 'Мои бензиновые', parentId: c12.id, description: 'д' });
  });

  it('незакреплённые название и родитель по-прежнему обновляются из фида', async () => {
    const db = createTestDb();
    await importXml(db, ymlXml({ categories: [`<category id="10">Генераторы</category>`, `<category id="11" parentId="10">Бензиновые</category>`], offers: [{ id: '1' }] }));
    await importXml(db, ymlXml({ categories: [`<category id="10">Генераторы 2</category>`, `<category id="11">Бензиновые</category>`], offers: [{ id: '1' }] }));
    expect(categoriesRepo.findByExternalId(db, 'yml', '10')?.name).toBe('Генераторы 2');
    expect(categoriesRepo.findByExternalId(db, 'yml', '11')?.parentId).toBeNull();
  });

  it('в миграции у существующих категорий есть уникальные коды, новые получают код сами', () => {
    const { db } = shop();
    const codes = (db.prepare('SELECT code FROM categories').all() as { code: string }[]).map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^cat_\d+$/.test(c))).toBe(true);
  });
});

describe('витрина учитывает показ в каталоге на уровне дерева', () => {
  it('getCategoryTree по умолчанию прячет категории с show_in_catalog = 0 вместе с ветками, но не меняет счётчики родителей', async () => {
    const { db, sad, trim, pumps } = shop();
    categoryOps.updateExtra(admin, trim, { showInMenu: true, showOnHome: true, showInCatalog: false, sort: 1, priority: 0, code: 'TRIM', externalRef: '', adminComment: '', relatedIds: [] }, o(db));
    const tree = await getCategoryTree({ db });
    const sadNode = tree.find((n) => n.id === sad)!;
    expect(sadNode.children).toEqual([]);
    expect(sadNode.productCount).toBe(3);
    expect(tree.map((n) => n.id)).toContain(pumps);
    const all = await getCategoryTree({ db, all: true });
    expect(all.find((n) => n.id === sad)!.children.map((c) => c.id)).toEqual([trim]);
  });
});

describe('массовые действия: скрыть / показать / перенести выбранные', () => {
  it('скрытие нескольких в одной транзакции: отчёт, каскад на потомков, ОДНА запись аудита с числом', () => {
    const { db, sad, trim, benzo, pumps, saws } = shop();
    const r = categoryBulkOps.run(admin, [trim, pumps, pumps], { type: 'hide' }, o(db));
    expect(r).toMatchObject({ total: 2, changed: 2, skipped: 0, cascaded: 1 }); // benzo скрыта каскадом
    expect(categoriesRepo.findById(db, benzo)).toMatchObject({ hiddenByAdmin: false, effectiveHidden: true });
    expect(categoriesRepo.findById(db, sad)?.effectiveHidden).toBe(false);
    expect(categoriesRepo.findById(db, saws)?.effectiveHidden).toBe(false);
    const recs = audit.list({ action: 'category.bulk' }, { db });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.after).toMatchObject({ changed: 2, ids: [trim, pumps] });
    expect(audit.list({ entity: 'category' }, { db })).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 5 });
  });

  it('повтор и смешанный выбор: уже скрытые и неизвестные пропускаются с причиной, остальное выполняется', () => {
    const { db, trim, pumps, saws } = shop();
    categoryBulkOps.run(admin, [trim], { type: 'hide' }, o(db));
    const r = categoryBulkOps.run(admin, [trim, pumps, 9999], { type: 'hide' }, o(db));
    expect(r).toMatchObject({ total: 3, changed: 1, skipped: 2 });
    expect(r.skippedItems.map((i) => i.id).sort()).toEqual([trim, 9999].sort());
    const none = categoryBulkOps.run(admin, [trim], { type: 'hide' }, o(db));
    expect(none.changed).toBe(0);
    expect(audit.list({ action: 'category.bulk' }, { db })).toHaveLength(2); // без изменений записи нет
    expect(saws).toBeGreaterThan(0);
  });

  it('показать: потомок, скрытый сам, остаётся скрытым после показа родителя', () => {
    const { db, trim, benzo } = shop();
    categoryBulkOps.run(admin, [trim, benzo], { type: 'hide' }, o(db));
    const r = categoryBulkOps.run(admin, [trim], { type: 'show' }, o(db));
    expect(r.changed).toBe(1);
    expect(categoriesRepo.findById(db, trim)?.effectiveHidden).toBe(false);
    expect(categoriesRepo.findById(db, benzo)).toMatchObject({ hiddenByAdmin: true, effectiveHidden: true });
  });

  it('перенос: выбранные уходят под родителя; в себя и потомков, и уже на месте — пропуск; в конец списка нового родителя', () => {
    const { db, sad, trim, benzo, pumps, saws } = shop();
    const r = categoryBulkOps.run(admin, [saws, pumps, sad], { type: 'move', parentId: trim }, o(db));
    expect(r).toMatchObject({ total: 3, changed: 2, skipped: 1 }); // sad — предок trim
    expect(categoriesRepo.findById(db, saws)).toMatchObject({ parentId: trim, lockedParent: true });
    expect(categoriesRepo.findById(db, pumps)?.parentId).toBe(trim);
    expect(categoriesRepo.findById(db, sad)?.parentId).toBeNull();
    expect(r.skippedItems[0]).toMatchObject({ id: sad });
    expect(categoryBulkOps.run(admin, [benzo], { type: 'move', parentId: trim }, o(db)).skippedItems[0]?.reason).toMatch(/Уже/);
    expect(categoryBulkOps.run(admin, [pumps], { type: 'move', parentId: null }, o(db)).changed).toBe(1);
    expect(() => categoryBulkOps.run(admin, [pumps], { type: 'move', parentId: 9999 }, o(db))).toThrow(NotFoundError);
  });

  it('перенос под скрытого родителя скрывает перенесённые для покупателя', () => {
    const { db, pumps, saws } = shop();
    categoryBulkOps.run(admin, [pumps], { type: 'hide' }, o(db));
    categoryBulkOps.run(admin, [saws], { type: 'move', parentId: pumps }, o(db));
    expect(categoriesRepo.findById(db, saws)?.effectiveHidden).toBe(true);
  });

  it('атомарность: ошибка посреди — ничего не меняется (неверный родитель проверяется до записи)', () => {
    const { db, trim, saws } = shop();
    expect(() => categoryBulkOps.run(admin, [trim, saws], { type: 'move', parentId: 9999 }, o(db))).toThrow(NotFoundError);
    expect(categoriesRepo.findById(db, trim)?.parentId).not.toBe(9999);
    expect(audit.list({ action: 'category.bulk' }, { db })).toEqual([]);
  });

  it('права и проверка входа: менеджер 403, без сессии 401, пустой выбор, неверные id и действие, слишком много', () => {
    const { db, trim } = shop();
    expect(() => categoryBulkOps.run(manager, [trim], { type: 'hide' }, o(db))).toThrow(ForbiddenError);
    expect(() => categoryBulkOps.run(content, [trim], { type: 'hide' }, o(db))).toThrow(ForbiddenError);
    expect(() => categoryBulkOps.run(null, [trim], { type: 'hide' }, o(db))).toThrow(UnauthorizedError);
    expect(() => categoryBulkOps.run(admin, [], { type: 'hide' }, o(db))).toThrow(ValidationError);
    expect(() => categoryBulkOps.run(admin, ['a'], { type: 'hide' }, o(db))).toThrow(ValidationError);
    expect(() => categoryBulkOps.run(admin, [trim], { type: 'delete' }, o(db))).toThrow(ValidationError);
    expect(() => categoryBulkOps.run(admin, Array.from({ length: 501 }, (_, i) => i + 1), { type: 'hide' }, o(db))).toThrow(ValidationError);
    expect(categoriesRepo.findById(db, trim)?.hiddenByAdmin).toBe(false);
  });

  it('«выбрать все»: в уровне и в поддереве', () => {
    const { db, sad, trim, benzo, pumps, saws } = shop();
    expect(categoryBulkOps.selectionIds(admin, { level: null }, { db })).toEqual([sad, pumps, saws]);
    expect(categoryBulkOps.selectionIds(manager, { level: sad }, { db })).toEqual([trim]);
    expect(categoryBulkOps.selectionIds(admin, { subtree: sad }, { db }).sort()).toEqual([sad, trim, benzo].sort());
    expect(() => categoryBulkOps.selectionIds(admin, { subtree: 9999 }, { db })).toThrow(NotFoundError);
  });
});
