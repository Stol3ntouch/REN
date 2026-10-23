import type { Metadata } from 'next';
import Link from 'next/link';
import { accountOrders } from '@/domain/customers/account';
import { STATUS_LABELS } from '@/domain/ordering';
import { formatRub } from '@/domain/pricing/format';
import '@/ui/cart/cart.css';
import { EmptyState } from '@/ui/states';
import { requireAccountPage } from '../guard';

export const metadata: Metadata = { title: 'Мои заказы', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const fmtDate = (ms: number) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(ms));

export default async function AccountOrdersPage() {
  const session = await requireAccountPage('/account/orders');
  const list = accountOrders.list(session.userId);

  if (list.length === 0) {
    return (
      <section aria-labelledby="acc-orders">
        <h2 id="acc-orders">Мои заказы</h2>
        <EmptyState title="Заказов пока нет">
          <p>
            Выберите товары в <Link href="/catalog">каталоге</Link>.
          </p>
        </EmptyState>
      </section>
    );
  }

  return (
    <section aria-labelledby="acc-orders">
      <h2 id="acc-orders">Мои заказы</h2>
      <div className="table-scroll">
        <table className="account-table">
          <caption className="visually-hidden">История заказов</caption>
          <thead>
            <tr>
              <th scope="col">Заказ</th>
              <th scope="col">Оформлен</th>
              <th scope="col">Статус</th>
              <th scope="col" className="num">
                Сумма
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => {
              const bad = o.status === 'cancelled' || o.status === 'payment_failed' || o.status === 'refunded';
              return (
                <tr key={o.id}>
                  <td>
                    <Link href={`/account/orders/${encodeURIComponent(o.number)}`}>{o.number}</Link>
                  </td>
                  <td>{fmtDate(o.createdAt)}</td>
                  <td>
                    <span className={`status-badge${bad ? ' status-badge--bad' : ''}`}>{STATUS_LABELS[o.status]}</span>
                  </td>
                  <td className="num">{formatRub(o.totalKopecks)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
