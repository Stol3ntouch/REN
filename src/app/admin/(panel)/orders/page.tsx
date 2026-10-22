import type { Metadata } from 'next';
import Link from 'next/link';
import { orderOps, parseOrderFilters } from '@/domain/ordering/admin-ops';
import { ORDER_STATUSES, STATUS_LABELS } from '@/domain/ordering/status';
import { formatRub } from '@/domain/pricing/format';
import '@/ui/cart/admin-orders.css';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';

export const metadata: Metadata = { title: 'Заказы' };
export const dynamic = 'force-dynamic';

const fmtTime = (ms: number) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(ms));

const str = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('orders.read');
  const sp = await searchParams;
  const filters = parseOrderFilters(sp);
  const result = orderOps.list(session, filters);
  const staff = orderOps.staffForAssignment(session);
  const staffName = new Map(staff.map((s) => [s.id, s.label]));
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  const link = (page: number) => {
    const p = new URLSearchParams();
    for (const key of ['q', 'status', 'from', 'to', 'assigned']) if (str(sp[key])) p.set(key, str(sp[key]));
    p.set('page', String(page));
    return `/admin/orders?${p.toString()}`;
  };

  return (
    <>
      <h1>Заказы</h1>
      <form method="get" className="adm-filters" role="search" aria-label="Поиск и фильтры заказов">
        <div className="adm-field">
          <label htmlFor="f-q">Номер, email, телефон, имя</label>
          <input id="f-q" name="q" type="search" defaultValue={str(sp.q)} maxLength={100} />
        </div>
        <div className="adm-field">
          <label htmlFor="f-status">Статус</label>
          <select id="f-status" name="status" defaultValue={str(sp.status)}>
            <option value="">Все</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor="f-from">С даты</label>
          <input id="f-from" name="from" type="date" defaultValue={str(sp.from)} />
        </div>
        <div className="adm-field">
          <label htmlFor="f-to">По дату</label>
          <input id="f-to" name="to" type="date" defaultValue={str(sp.to)} />
        </div>
        <div className="adm-field">
          <label htmlFor="f-assigned">Ответственный</label>
          <select id="f-assigned" name="assigned" defaultValue={str(sp.assigned)}>
            <option value="">Любой</option>
            <option value="none">Не назначен</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Найти
          </button>
          <Link href="/admin/orders" className="button button--outline">
            Сбросить
          </Link>
        </div>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState title="Заказов не найдено">
          <p>Измените условия поиска или сбросьте фильтры.</p>
        </EmptyState>
      ) : (
        <>
          <p>Найдено: {result.total}</p>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Список заказов</caption>
              <thead>
                <tr>
                  <th scope="col">Номер</th>
                  <th scope="col">Дата</th>
                  <th scope="col">Покупатель</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Ответственный</th>
                  <th scope="col" className="num">
                    Сумма
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/orders/${o.number}`}>{o.number}</Link>
                    </td>
                    <td>{fmtTime(o.createdAt)}</td>
                    <td>
                      {o.contactName}
                      <br />
                      {o.contactPhone}
                    </td>
                    <td>{STATUS_LABELS[o.status]}</td>
                    <td>{o.assignedStaffId ? (staffName.get(o.assignedStaffId) ?? `№${o.assignedStaffId}`) : '—'}</td>
                    <td className="num">{formatRub(o.totalKopecks)}</td>
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
