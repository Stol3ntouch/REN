import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { customersOps } from '../_lib/customers-ops';
import { fmtTime, int, str } from '../_lib/ui';
import '../_lib/ops.css';
import '@/ui/cart/admin-orders.css';

export const metadata: Metadata = { title: 'Покупатели' };
export const dynamic = 'force-dynamic';

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('customers.read');
  const sp = await searchParams;
  const q = str(sp.q).trim().slice(0, 100);
  const result = customersOps.list(session, { q: q || undefined, page: int(sp.page, 1) });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (page: number) => `/admin/customers?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page) }).toString()}`;

  return (
    <>
      <h1>Покупатели</h1>
      <form method="get" className="adm-filters" role="search" aria-label="Поиск покупателей">
        <div className="adm-field">
          <label htmlFor="cu-q">Email, имя или телефон</label>
          <input id="cu-q" name="q" type="search" defaultValue={q} maxLength={100} />
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Найти
          </button>
          <Link href="/admin/customers" className="button button--outline">
            Сбросить
          </Link>
        </div>
      </form>
      {result.rows.length === 0 ? (
        <EmptyState title="Покупателей не найдено" />
      ) : (
        <>
          <p>Найдено: {result.total}</p>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Покупатели</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Имя</th>
                  <th scope="col">Телефон</th>
                  <th scope="col">Регистрация</th>
                  <th scope="col" className="num">
                    Заказов
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/customers/${c.id}`}>{c.email}</Link>
                    </td>
                    <td>{c.name ?? '—'}</td>
                    <td>{c.phone ?? '—'}</td>
                    <td>{fmtTime(c.createdAt)}</td>
                    <td className="num">{c.ordersCount}</td>
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
