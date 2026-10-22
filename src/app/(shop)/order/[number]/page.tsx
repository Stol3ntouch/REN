import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveOwner } from '@/domain/customers/session';
import { orders, STATUS_LABELS } from '@/domain/ordering';
import { formatRub } from '@/domain/pricing/format';
import '@/ui/cart/cart.css';
import { Totals } from '@/ui/cart/Totals';
import { SuccessState } from '@/ui/states';

// Страница заказа закрыта от поисковиков и не отдаёт Referer (в адресе гостевой токен).
export const metadata: Metadata = { title: 'Заказ', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

const fmtTime = (ms: number) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(ms));

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ t?: string; placed?: string }> };

export default async function OrderPage({ params, searchParams }: Props) {
  const [{ number }, sp] = await Promise.all([params, searchParams]);
  const number_ = decodeURIComponent(number);
  const owner = resolveOwner(await cookies());
  // Заказ видит владелец (пользователь или гость по cookie) либо тот, у кого верная подписанная ссылка. Иначе — 404.
  const order = orders.getForCustomer(number_, owner) ?? orders.getByGuestToken(number_, typeof sp.t === 'string' ? sp.t : null);
  if (!order) notFound();

  const events = orders.events(order.id, { forCustomer: true });
  const bad = order.status === 'cancelled' || order.status === 'payment_failed' || order.status === 'refunded';

  return (
    <div className="order-page container">
      <h1>Заказ {order.number}</h1>
      {sp.placed ? (
        <SuccessState title="Спасибо, заказ принят">
          <p>Мы свяжемся с вами для подтверждения. Статус заказа можно смотреть на этой странице. Сохраните ссылку на неё.</p>
        </SuccessState>
      ) : null}

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
                    <td className="num">
                      {i.discountPriceKopecks !== null ? <span className="price__old">{formatRub(i.priceKopecks)}</span> : null}
                      {formatRub(i.unitKopecks)}
                    </td>
                    <td className="num">{i.qty}</td>
                    <td className="num">{formatRub(i.lineKopecks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section aria-labelledby="order-contacts">
            <h2 id="order-contacts">Получение и оплата</h2>
            <p>
              {order.contact.name}, {order.contact.phone}, {order.contact.email}
            </p>
            <p>
              Получение: {order.delivery.name}
              {order.contact.address ? ` — ${order.contact.address}` : ''}
            </p>
            <p>Оплата: {order.payment.name}</p>
            {order.contact.comment ? <p>Комментарий: {order.contact.comment}</p> : null}
          </section>

          <section aria-labelledby="order-history">
            <h2 id="order-history">История</h2>
            <ol className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="timeline__time">{fmtTime(e.at)}</span> —{' '}
                  {e.kind === 'created' ? 'Заказ оформлен' : e.toStatus ? STATUS_LABELS[e.toStatus] : 'Обновление'}
                </li>
              ))}
            </ol>
          </section>
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
        <Link href="/catalog">Вернуться в каталог</Link>
      </p>
    </div>
  );
}
