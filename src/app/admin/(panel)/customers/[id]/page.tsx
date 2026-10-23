import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { STATUS_LABELS, isOrderStatus } from '@/domain/ordering/status';
import { formatRub } from '@/domain/pricing/format';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { customersOps } from '../../_lib/customers-ops';
import { fmtTime } from '../../_lib/ui';
import '../../_lib/ops.css';
import '@/ui/cart/admin-orders.css';

export const metadata: Metadata = { title: 'Покупатель' };
export const dynamic = 'force-dynamic';

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffPage('customers.read');
  const id = Number((await params).id);
  const profile = Number.isInteger(id) ? customersOps.get(session, id) : null;
  if (!profile) notFound();
  const { user, orders } = profile;

  return (
    <>
      <h1>{user.name ?? user.email}</h1>
      <p>
        <Link href="/admin/customers">← К списку покупателей</Link>
      </p>
      <dl className="adm-card">
        <div>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Имя</dt>
          <dd>{user.name ?? '—'}</dd>
        </div>
        <div>
          <dt>Телефон</dt>
          <dd>{user.phone ?? '—'}</dd>
        </div>
        <div>
          <dt>Зарегистрирован</dt>
          <dd>{fmtTime(user.createdAt)}</dd>
        </div>
      </dl>
      <h2>Заказы</h2>
      {orders.length === 0 ? (
        <EmptyState title="Заказов пока нет" />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Заказы покупателя</caption>
            <thead>
              <tr>
                <th scope="col">Номер</th>
                <th scope="col">Дата</th>
                <th scope="col">Статус</th>
                <th scope="col" className="num">
                  Сумма
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/admin/orders/${o.number}`}>{o.number}</Link>
                  </td>
                  <td>{fmtTime(o.createdAt)}</td>
                  <td>{isOrderStatus(o.status) ? STATUS_LABELS[o.status] : o.status}</td>
                  <td className="num">{formatRub(o.totalKopecks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
