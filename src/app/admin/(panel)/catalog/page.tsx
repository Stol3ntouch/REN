import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { catalogOps } from '../_lib/catalog-ops';
import { CATALOG_NAV, Flash, int, str, SubNav } from '../_lib/ui';
import { ProductTable } from './ProductTable';

export const metadata: Metadata = { title: 'Каталог' };
export const dynamic = 'force-dynamic';

const triState = (v: string): boolean | undefined => (v === '1' ? true : v === '0' ? false : undefined);

export default async function AdminCatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  const categoryId = int(sp.category, 0);
  const filter = {
    q: str(sp.q).trim().slice(0, 100) || undefined,
    categoryId: categoryId || undefined,
    published: triState(str(sp.published)),
    hiddenOnly: str(sp.hidden) === '1' || undefined,
    page: int(sp.page, 1),
  };
  const result = catalogOps.list(session, filter, {});
  const categories = catalogOps.categories(session);
  const manualEdit = catalogOps.isManualEditEnabled();
  const canWrite = hasPermission(session.role, 'catalog.write');
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (page: number) => {
    const p = new URLSearchParams();
    for (const k of ['q', 'category', 'published', 'hidden']) if (str(sp[k])) p.set(k, str(sp[k]));
    p.set('page', String(page));
    return `/admin/catalog?${p.toString()}`;
  };
  const backPath = link(result.page);

  return (
    <>
      <h1>Каталог</h1>
      <SubNav items={CATALOG_NAV} current="/admin/catalog" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Готово: видимость на сайте обновлена." />
      <p>
        Всего товаров: {result.counts.all}, скрыто с сайта: {result.counts.hidden}.
      </p>
      <p className="ops-muted">
        {manualEdit ? 'Ручное редактирование включено: цены, публикацию и описания можно править в карточке товара.' : 'Источник данных — импорт YML / 1С: поля только для чтения. Ручное редактирование включается в настройках.'}
      </p>
      <form method="get" className="adm-filters" role="search" aria-label="Поиск и фильтры товаров">
        <div className="adm-field">
          <label htmlFor="c-q">Название или артикул</label>
          <input id="c-q" name="q" type="search" defaultValue={str(sp.q)} maxLength={100} />
        </div>
        <div className="adm-field">
          <label htmlFor="c-cat">Категория</label>
          <select id="c-cat" name="category" defaultValue={str(sp.category)}>
            <option value="">Все</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor="c-pub">Публикация</label>
          <select id="c-pub" name="published" defaultValue={str(sp.published)}>
            <option value="">Любая</option>
            <option value="1">Опубликован</option>
            <option value="0">Скрыт</option>
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor="c-hid">
            <input id="c-hid" name="hidden" type="checkbox" value="1" defaultChecked={str(sp.hidden) === '1'} /> Только скрытые
          </label>
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Найти
          </button>
          <Link href="/admin/catalog" className="button button--outline">
            Сбросить
          </Link>
        </div>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState title="Товаров не найдено">
          <p>Измените условия поиска или загрузите каталог в разделе «Импорт».</p>
        </EmptyState>
      ) : (
        <>
          <p>Найдено: {result.total}</p>
          <ProductTable rows={result.rows} canWrite={canWrite} back={backPath} />
          <nav className="adm-pager" aria-label="Страницы">
            {result.page > 1 ? <Link href={link(result.page - 1)}>← Назад</Link> : null}
            <span>
              Страница {result.page} из {pages}
            </span>
            {result.page < pages ? <Link href={link(result.page + 1)}>Вперёд →</Link> : null}
          </nav>
        </>
      )}
    </>
  );
}
