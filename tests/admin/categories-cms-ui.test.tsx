import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { categoryOps } from '@/app/admin/(panel)/_lib/category-ops';
import { categoryTreeOps } from '@/app/admin/(panel)/_lib/category-tree-ops';
import { BannersTab, CategoryHeader, ExtraTab, SeoTab, SubcategoriesTab } from '@/app/admin/(panel)/catalog/categories/CategoryCard';
import { createCategoryChildrenHandler } from '@/app/admin/api/categories/children/handler';
import { createTestDb } from '@/server/db/testing';
import { req, staffCookies, T0 } from '../analytics/staff-cookies';
import { addCategory, addProduct } from '../catalog/helpers';
import { admin, manager } from './helpers';

function shop() {
  const db = createTestDb();
  const sad = addCategory(db, 'Садовая техника', 'sad');
  const trim = addCategory(db, 'Триммеры', 'trimmery', sad);
  const pumps = addCategory(db, 'Насосы', 'nasosy');
  addProduct(db, { name: 'Триммер', categoryId: trim });
  return { db, sad, trim, pumps };
}

describe('GET /admin/api/categories/children', () => {
  it('без входа 401; корни и уровни; поиск с путём; путь до категории; неверный parent — 400', async () => {
    const { db, sad, trim } = shop();
    const c = await staffCookies(db);
    const h = createCategoryChildrenHandler({ db, now: T0 });
    const url = (qs: string) => `http://shop.test/admin/api/categories/children?${qs}`;
    expect((await h(req(url('parent=root')))).status).toBe(401);
    const roots = await (await h(req(url('parent=root'), { cookie: c.admin }))).json();
    expect(roots.nodes.map((n: { id: number }) => n.id)).toContain(sad);
    expect(roots.total).toBe(1);
    const level = await (await h(req(url(`parent=${sad}`), { cookie: c.manager }))).json();
    expect(level.nodes).toMatchObject([{ id: trim, productCount: 1 }]);
    const hits = await (await h(req(url('q=триммер'), { cookie: c.admin }))).json();
    expect(hits.hits[0]).toMatchObject({ id: trim, path: 'Садовая техника › Триммеры' });
    expect((await (await h(req(url(`path=${trim}`), { cookie: c.admin }))).json()).path).toEqual([sad, trim]);
    expect((await h(req(url('parent=abc'), { cookie: c.admin }))).status).toBe(400);
    expect((await h(req(url('parent=99999'), { cookie: c.admin }))).status).toBe(404);
  });
});

describe('карточка категории: разметка', () => {
  it('список подкатегорий: флажки выбора, панель «Скрыть / Показать / Перенести» для admin; менеджер — только чтение', () => {
    const { db, sad } = shop();
    const card = categoryOps.get(admin, sad, { db })!;
    const rows = categoryTreeOps.children(admin, sad, { db }).nodes;
    const parents = categoryOps.parentOptions(admin, null, { db });
    const html = renderToStaticMarkup(<SubcategoriesTab card={card} rows={rows} canWrite parents={parents} back={`/admin/catalog/categories?id=${sad}&tab=subcategories`} />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="ids"');
    expect(html).toContain('Скрыть выбранные');
    expect(html).toContain('Показать выбранные');
    expect(html).toContain('Перенести');
    expect(html).toContain('Выбрать «Триммеры»');
    const ro = renderToStaticMarkup(<SubcategoriesTab card={card} rows={rows} canWrite={false} parents={parents} back="/admin/catalog/categories" />);
    expect(ro).not.toContain('Скрыть выбранные');
    expect(ro).not.toContain('name="ids"');
  });

  it('«Дополнительно»: три независимых флага, позиция, приоритет, код, внешний ID, комментарий, связанные; кнопки «Сохранить изменения» и «Отмена»', () => {
    const { db, sad } = shop();
    const card = categoryOps.get(admin, sad, { db })!;
    const html = renderToStaticMarkup(<ExtraTab card={card} canWrite />);
    for (const name of ['showInMenu', 'showOnHome', 'showInCatalog', 'sort', 'priority', 'code', 'externalRef', 'adminComment']) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('Показывать в меню');
    expect(html).toContain('Показывать на главной странице');
    expect(html).toContain('Показывать в каталоге');
    expect(html).toContain('Сохранить изменения');
    expect(html).toContain('Отмена');
    expect(html).toContain('type="reset"'); // «Отмена» откатывает несохранённые правки формы
    expect(renderToStaticMarkup(<ExtraTab card={card} canWrite={false} />)).not.toContain('Сохранить изменения');
  });

  it('шапка и SEO: у менеджера полей для сохранения нет; у админа — форма; скрытая категория помечена', () => {
    const { db, sad } = shop();
    const card = categoryOps.get(admin, sad, { db })!;
    const parents = categoryOps.parentOptions(admin, sad, { db });
    const head = renderToStaticMarkup(<CategoryHeader card={card} parents={parents} canWrite editing={false} back="/admin/catalog/categories?id=1" />);
    expect(head).toContain('Редактировать категорию');
    expect(head).toContain('Активная');
    expect(head).toContain('Родительская категория');
    expect(head).toContain('Позиция в меню');
    const editing = renderToStaticMarkup(<CategoryHeader card={card} parents={parents} canWrite editing back="/admin/catalog/categories?id=1" />);
    expect(editing).toContain('name="slug"');
    const ro = renderToStaticMarkup(<CategoryHeader card={categoryOps.get(manager, sad, { db })!} parents={parents} canWrite={false} editing={false} back="/x" />);
    expect(ro).not.toContain('Редактировать категорию');
    expect(ro).not.toContain('Сохранить изменения');
    expect(renderToStaticMarkup(<SeoTab card={card} canWrite />)).toContain('name="canonical"');
    expect(renderToStaticMarkup(<BannersTab card={card} links={[]} choices={[]} canWrite />)).toContain('Нет свободных баннеров');
  });
});
