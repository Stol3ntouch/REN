import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { orderOps, REFUND_PERMISSION } from '@/domain/ordering/admin-ops';
import { STATUS_LABELS, TRANSITIONS, type OrderStatus } from '@/domain/ordering/status';
import { formatRub } from '@/domain/pricing/format';
import '@/ui/cart/admin-orders.css';
import { requireStaffPage } from '@/ui/admin/guard';
import { addNoteAction, assignOrderAction, cancelOrderAction, changeStatusAction, refundOrderAction } from '../actions';

export const metadata: Metadata = { title: 'Заказ' };
export const dynamic = 'force-dynamic';

const fmtTime = (ms: number) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(ms));

// Эти статусы руками не ставятся: «оплачен»/«ошибка оплаты» — по webhook, возврат — отдельной кнопкой администратора, отмена — отдельной кнопкой.
const MANUAL_BLOCKED: readonly OrderStatus[] = ['paid', 'payment_failed', 'refunded', 'cancelled'];

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function AdminOrderPage({ params, searchParams }: Props) {
  const session = await requireStaffPage('orders.read');
  const [{ number }, sp] = await Promise.all([params, searchParams]);
  const order = orderOps.get(session, decodeURIComponent(number));
  if (!order) notFound();

  const events = orderOps.history(session, order.id);
  const staff = orderOps.staffForAssignment(session);
  const canWrite = hasPermission(session, 'orders.write');
  const canRefund = hasPermission(session, REFUND_PERMISSION) && order.isPaid;
  const nextStatuses = TRANSITIONS[order.status].filter((s) => !MANUAL_BLOCKED.includes(s));
  const canCancel = TRANSITIONS[order.status].includes('cancelled') && !order.isPaid;
  const staffName = new Map(staff.map((s) => [s.id, s.label]));
  const hidden = (
    <>
      <input type="hidden" name="orderId" value={order.id} />
      <input type="hidden" name="number" value={order.number} />
    </>
  );

  return (
    <>
      <p>
        <Link href="/admin/orders">← Все заказы</Link>
      </p>
      <h1>Заказ {order.number}</h1>
      {sp.ok ? (
        <p className="adm-flash" role="status">
          Готово.
        </p>
      ) : null}
      {sp.error ? (
        <p className="adm-flash adm-flash--error" role="alert">
          {sp.error}
        </p>
      ) : null}

      <div className="adm-grid adm-grid--two">
        <div className="adm-grid">
          <section className="adm-card" aria-labelledby="o-main">
            <h2 id="o-main">Заказ</h2>
            <p>
              Статус: <strong>{STATUS_LABELS[order.status]}</strong>
              {order.isPaid ? ' · оплачен' : ''} · создан {fmtTime(order.createdAt)}
            </p>
            <p>
              Ответственный: {order.assignedStaffId ? (staffName.get(order.assignedStaffId) ?? `сотрудник №${order.assignedStaffId}`) : 'не назначен'}
            </p>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <caption className="visually-hidden">Состав заказа</caption>
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col">Артикул</th>
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
                      <td>{i.name}</td>
                      <td>{i.sku ?? '—'}</td>
                      <td className="num">
                        {formatRub(i.unitKopecks)}
                        {i.discountPriceKopecks !== null ? ` (розн. ${formatRub(i.priceKopecks)})` : ''}
                      </td>
                      <td className="num">{i.qty}</td>
                      <td className="num">{formatRub(i.lineKopecks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Товары: {formatRub(order.subtotalKopecks)}
              {order.discountKopecks > 0 ? ` · скидка${order.promoCode ? ` (${order.promoCode})` : ''}: −${formatRub(order.discountKopecks)}` : ''} ·
              доставка: {order.delivery.pending ? 'рассчитать менеджеру' : formatRub(order.deliveryKopecks)} · <strong>итого {formatRub(order.totalKopecks)}</strong>
            </p>
          </section>

          <section className="adm-card" aria-labelledby="o-contact">
            <h2 id="o-contact">Покупатель</h2>
            <p>{order.contact.name}</p>
            <p>{order.contact.phone}</p>
            <p>{order.contact.email}</p>
            <p>
              Получение: {order.delivery.name}
              {order.contact.address ? ` — ${order.contact.address}` : ''}
            </p>
            <p>Оплата: {order.payment.name}</p>
            {order.contact.comment ? <p>Комментарий покупателя: {order.contact.comment}</p> : null}
          </section>

          <section className="adm-card" aria-labelledby="o-history">
            <h2 id="o-history">История</h2>
            <ol className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="timeline__time">{fmtTime(e.at)}</span> —{' '}
                  {e.kind === 'created'
                    ? 'заказ оформлен'
                    : e.kind === 'status'
                      ? `${e.fromStatus ? STATUS_LABELS[e.fromStatus] : '—'} → ${e.toStatus ? STATUS_LABELS[e.toStatus] : '—'}`
                      : e.kind === 'assigned'
                        ? 'ответственный'
                        : 'заметка'}{' '}
                  ({e.actorType === 'staff' ? `сотрудник №${e.actorId}` : e.actorType === 'system' ? 'система' : 'покупатель'}){e.note ? `: ${e.note}` : ''}
                </li>
              ))}
            </ol>
          </section>
        </div>

        {canWrite ? (
          <div className="adm-grid">
            {nextStatuses.length > 0 ? (
              <form action={changeStatusAction} className="adm-card">
                {hidden}
                <h2>Сменить статус</h2>
                <div className="adm-field">
                  <label htmlFor="s-status">Новый статус</label>
                  <select id="s-status" name="status" required>
                    {nextStatuses.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="adm-field">
                  <label htmlFor="s-note">Комментарий (необязательно)</label>
                  <input id="s-note" name="note" maxLength={500} />
                </div>
                <button type="submit" className="button">
                  Сменить статус
                </button>
              </form>
            ) : null}

            <form action={assignOrderAction} className="adm-card">
              {hidden}
              <h2>Ответственный</h2>
              <div className="adm-field">
                <label htmlFor="a-staff">Менеджер</label>
                <select id="a-staff" name="staffId" defaultValue={order.assignedStaffId ?? ''}>
                  <option value="">Не назначен</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="button button--outline">
                Назначить
              </button>
            </form>

            <form action={addNoteAction} className="adm-card">
              {hidden}
              <h2>Заметка</h2>
              <div className="adm-field">
                <label htmlFor="n-note">Внутренняя заметка (покупатель её не видит)</label>
                <textarea id="n-note" name="note" rows={3} maxLength={500} required />
              </div>
              <button type="submit" className="button button--outline">
                Добавить
              </button>
            </form>

            {canCancel ? (
              <form action={cancelOrderAction} className="adm-card">
                {hidden}
                <h2>Отмена заказа</h2>
                <div className="adm-field">
                  <label htmlFor="c-note">Причина</label>
                  <input id="c-note" name="note" maxLength={500} />
                </div>
                <button type="submit" className="button button--outline">
                  Отменить заказ
                </button>
              </form>
            ) : null}

            {canRefund ? (
              <form action={refundOrderAction} className="adm-card">
                {hidden}
                <h2>Возврат средств</h2>
                <p>Только администратор. Возврат идёт через платёжную систему.</p>
                <div className="adm-field">
                  <label htmlFor="r-note">Комментарий</label>
                  <input id="r-note" name="note" maxLength={500} />
                </div>
                <button type="submit" className="button button--outline">
                  Вернуть деньги
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
