import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountOrders } from '@/domain/customers/account';
import { orders, STATUS_LABELS } from '@/domain/ordering';
import type { Order } from '@/domain/ordering';
import { formatRub } from '@/domain/pricing/format';
import { NotFoundError } from '@/server/http/errors';
import '@/ui/cart/cart.css';
import { Totals } from '@/ui/cart/Totals';
import { ReorderForm } from '../../ReorderForm';
import { requireAccountPage } from '../../guard';

export const metadata: Metadata = { title: 'Заказ', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

const fmtTime = (ms: number) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(ms));

export default async function AccountOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const ref = decodeURIComponent(number);
  const session = await requireAccountPage(`/account/orders/${encodeURIComponent(ref)}`);

  // Чужой и несуществующий заказ неразличимы: 404
  let order: Order;
  try {
    order = accountOrders.get(session.userId, ref);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  const events = orders.events(order.id, { forCustomer: true });
  const bad = order.status === 'cancelled' || order.status === 'payment_failed' || order.status === 'refunded';

  return (
    <section aria-labelledby="acc-order">
      <h2 id="acc-order">Заказ {order.number}</h2>
      <p>
        Статус: <span className={`status-badge${bad ? ' status-badge--bad' : ''}`}>{STATUS_LABELS[order.status]}</span> · оформлен {fmtTime(order.createdAt)}
      </p>

      <div className="checkout-layout">
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div className="table-scroll">
            <table className="order-items">
              <caption className="visually-hidden">Состав заказа</caption>
              <thead>
                <tr>
                  <th scope="col">Товар</th>
                  <th scope="col" className="num">
                    Цена
                  </th>
                  <th scope="col" className="num">
                    Кол-во
                  </th>
                  <th scope="col" className="num">
                    Сумма
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name}
                      {i.sku ? <div className="cart-line__sku">Артикул: {i.sku}</div> : null}
                    </td>
                    <td className="num">{formatRub(i.unitKopecks)}</td>
                    <td className="num">{i.qty}</td>
                    <td className="num">{formatRub(i.lineKopecks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section aria-labelledby="acc-order-delivery">
            <h3 id="acc-order-delivery">Получение и оплата</h3>
            <p>
              Получение: {order.delivery.name}
              {order.contact.address ? ` — ${order.contact.address}` : ''}
            </p>
            <p>Оплата: {order.payment.name}</p>
          </section>

          <section aria-labelledby="acc-order-history">
            <h3 id="acc-order-history">История</h3>
            <ol className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="timeline__time">{fmtTime(e.at)}</span> — {e.kind === 'created' ? 'Заказ оформлен' : e.toStatus ? STATUS_LABELS[e.toStatus] : 'Обновление'}
                </li>
              ))}
            </ol>
          </section>

          <ReorderForm number={order.number} />
        </div>

        <aside>
          <Totals
            title="Сумма заказа"
            subtotalKopecks={order.subtotalKopecks}
            discountKopecks={order.discountKopecks}
            promoCode={order.promoCode}
            delivery={{ name: order.delivery.name, kopecks: order.delivery.priceKopecks, pending: order.delivery.pending }}
            totalKopecks={order.totalKopecks}
          />
        </aside>
      </div>

      <p>
        <Link href="/account/orders">К списку заказов</Link>
      </p>
    </section>
  );
}
