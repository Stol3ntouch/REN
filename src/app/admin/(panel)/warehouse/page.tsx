import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { catalogOps } from '../_lib/catalog-ops';
import { CATALOG_NAV, int, str, SubNav } from '../_lib/ui';

export const metadata: Metadata = { title: 'Склад' };
export const dynamic = 'force-dynamic';

/** Склад — только просмотр наличия (да/нет). Остатков числом в данных нет; источник — 1С/YML. */
export default async function AdminWarehousePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  const stock = str(sp.stock);
  const result = catalogOps.list(session, {
    q: str(sp.q).trim().slice(0, 100) || undefined,
    inStock: stock === '1' ? true : stock === '0' ? false : undefined,
    page: int(sp.page, 1),
    pageSize: 50,
  });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (page: number) => {
    const p = new URLSearchParams();
    for (const k of ['q', 'stock']) if (str(sp[k])) p.set(k, str(sp[k]));
    p.set('page', String(page));
    return `/admin/warehouse?${p.toString()}`;
  };

  return (
    <>
      <h1>Склад</h1>
      <SubNav items={CATALOG_NAV} current="/admin/warehouse" />
      <p className="ops-muted">Показано наличие «есть / нет» из импорта. Количество на складе в данных отсутствует; учёт ведётся в 1С.</p>
      <form method="get" className="adm-filters" role="search" aria-label="Фильтр наличия">
        <div className="adm-field">
          <label htmlFor="w-q">Название или артикул</label>
          <input id="w-q" name="q" type="search" defaultValue={str(sp.q)} maxLength={100} />
        </div>
        <div className="adm-field">
          <label htmlFor="w-s">Наличие</label>
          <select id="w-s" name="stock" defaultValue={stock}>
            <option value="">Любое</option>
            <option value="1">В наличии</option>
            <option value="0">Нет в наличии</option>
          </select>
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Показать
          </button>
        </div>
      </form>
      {result.rows.length === 0 ? (
        <EmptyState title="Нет данных" />
      ) : (
        <>
          <p>Найдено: {result.total}</p>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Наличие товаров</caption>
              <thead>
                <tr>
                  <th scope="col">Название</th>
                  <th scope="col">Артикул</th>
                  <th scope="col">Наличие</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/catalog/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.sku ?? '—'}</td>
                    <td>
                      <span className={`ops-badge ${p.inStock ? 'ops-badge--ok' : 'ops-badge--warn'}`}>{p.inStock ? 'в наличии' : 'нет в наличии'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
