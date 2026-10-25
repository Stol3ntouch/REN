import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { orderOps, REFUND_PERMISSION } from '@/domain/ordering/admin-ops';
import { ITEMS_EDITABLE_STATUSES, CONTACT_EDITABLE_STATUSES, PRIVILEGED_REVERT_FROM, REVERSE_TRANSITIONS, STATUS_LABELS, TRANSITIONS, type OrderStatus } from '@/domain/ordering/status';
import { formatRub } from '@/domain/pricing/format';
import { requireStaffPage } from '@/ui/admin/guard';
import { FlashToast, FormField, PageHeader, SelectField, TextAreaField } from '@/ui/admin/kit';
import { fmtTime } from '../../_lib/ui';
import '@/ui/cart/admin-orders.css';
import {
  addNoteAction,
  assignOrderAction,
  cancelOrderAction,
  changeStatusAction,
  editItemsAction,
  markPaidAction,
  refundOrderAction,
  revertStatusAction,
  updateDetailsAction,
} from '../actions';

export const metadata: Metadata = { title: 'Заказ' };
export const dynamic = 'force-dynamic';

// «Оплачен»/«ошибка оплаты» ставит только webhook, возврат и отмена — отдельными кнопками.
const MANUAL_BLOCKED: readonly OrderStatus[] = ['paid', 'payment_failed', 'refunded', 'cancelled'];

const EVENT_TEXT: Record<string, string> = {
  created: 'заказ оформлен',
  note: 'добавлен внутренний комментарий',
  assigned: 'ответственный',
  edit: 'правка данных',
  items: 'изменён состав',
  'payment.manual': 'оплата отмечена вручную',
  revert: 'возврат на шаг',
};

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function AdminOrderPage({ params, searchParams }: Props) {
  const session = await requireStaffPage('orders.read');
  const [{ number }, sp] = await Promise.all([params, searchParams]);
  const order = orderOps.get(session, decodeURIComponent(number));
  if (!order) notFound();

  const events = orderOps.history(session, order.id);
  const comments = orderOps.comments(session, order.id);
  const pay = orderOps.paymentInfo(session, order.id);
  const staff = orderOps.staffForAssignment(session);
  const staffName = new Map(staff.map((s) => [String(s.id), s.label]));
  const canWrite = hasPermission(session, 'orders.write');
  const canRefund = hasPermission(session, REFUND_PERMISSION);
  const nextStatuses = TRANSITIONS[order.status].filter((s) => !MANUAL_BLOCKED.includes(s));
  const revertTo = REVERSE_TRANSITIONS[order.status].filter(() => !PRIVILEGED_REVERT_FROM.includes(order.status) || canRefund);
  const canCancel = TRANSITIONS[order.status].includes('cancelled') && !order.isPaid;
  const itemsEditable = ITEMS_EDITABLE_STATUSES.includes(order.status) && !order.isPaid;
  const contactEditable = CONTACT_EDITABLE_STATUSES.includes(order.status);
  const hidden = (
    <>
      <input type="hidden" name="orderId" value={order.id} />
      <input type="hidden" name="number" value={order.number} />
    </>
  );
  const actor = (type: string, id: string | null) => (type === 'staff' ? (staffName.get(id ?? '') ?? `сотрудник №${id}`) : type === 'system' ? 'система' : 'покупатель');

  return (
    <>
      <FlashToast ok={sp.ok} error={sp.error} />
      <p>
        <Link href="/admin/orders">← Все заказы</Link>
      </p>
      <PageHeader title={`Заказ ${order.number}`} description={`${STATUS_LABELS[order.status]}${order.isPaid ? ' · оплачен' : ''} · создан ${fmtTime(order.createdAt)}`} actions={<a className="ak-btn" href={`/admin/orders/${order.number}/print`} target="_blank" rel="noopener">Печать</a>} />

      <div className="ak-grid-2">
        <div className="ak-stack">
          <section className="ak-card" aria-labelledby="o-items">
            <h2 id="o-items">Состав заказа</h2>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <caption className="visually-hidden">Состав заказа</caption>
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col">Артикул</th>
                    <th scope="col" className="num">Цена</th>
                    <th scope="col" className="num">Скидка</th>
                    <th scope="col" className="num">Кол-во</th>
                    <th scope="col" className="num">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td>{i.sku ?? '—'}</td>
                      <td className="num">{formatRub(i.priceKopecks)}</td>
                      <td className="num">{i.discountPriceKopecks !== null ? `−${formatRub(i.priceKopecks - i.unitKopecks)}` : '—'}</td>
                      <td className="num">{i.qty}</td>
                      <td className="num">{formatRub(i.lineKopecks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Товары: {formatRub(order.subtotalKopecks)} · скидка{order.promoCode ? ` (купон ${order.promoCode})` : ''}: {order.discountKopecks > 0 ? `−${formatRub(order.discountKopecks)}` : '0'} · доставка:{' '}
              {order.delivery.pending ? 'рассчитает менеджер' : formatRub(order.deliveryKopecks)} · <strong>итого {formatRub(order.totalKopecks)}</strong>
            </p>
          </section>

          <section className="ak-card" aria-labelledby="o-contact">
            <h2 id="o-contact">Покупатель и получение</h2>
            <p>{order.contact.name} · {order.contact.phone} · {order.contact.email}</p>
            <p>Получение: {order.delivery.name}{order.contact.address ? ` — ${order.contact.address}` : ''}</p>
            <p>Оплата: {order.payment.name}</p>
            {order.contact.comment ? <p>Комментарий покупателя: {order.contact.comment}</p> : null}
            {canWrite && contactEditable ? (
              <form action={updateDetailsAction}>
                {hidden}
                <h3>Изменить данные</h3>
                <div className="ak-form-grid">
                  <FormField name="name" label="Имя" defaultValue={order.contact.name} maxLength={100} required />
                  <FormField name="phone" label="Телефон" defaultValue={order.contact.phone} maxLength={30} required />
                  <FormField name="email" label="Email" type="email" defaultValue={order.contact.email} maxLength={254} required />
                  <FormField name="address" label="Адрес доставки" defaultValue={order.contact.address ?? ''} maxLength={300} />
                </div>
                <TextAreaField name="comment" label="Комментарий покупателя" defaultValue={order.contact.comment ?? ''} rows={2} maxLength={1000} />
                <button type="submit" className="ak-btn">Сохранить данные</button>
              </form>
            ) : null}
          </section>

          {canWrite && itemsEditable ? (
            <form action={editItemsAction} className="ak-card">
              {hidden}
              <h2>Изменить состав</h2>
              <p className="ak-muted">Цены прежних позиций остаются как при оформлении; суммы и скидку купона пересчитает сервер. После передачи в доставку состав менять нельзя.</p>
              {order.items.map((i) => (
                <FormField key={i.id} name={`qty_${i.id}`} label={`${i.name} — количество (0 — убрать)`} type="number" min={0} max={20} defaultValue={i.qty} />
              ))}
              <div className="ak-form-grid">
                <FormField name="addProductId" label="Добавить товар (ID товара)" inputMode="numeric" />
                <FormField name="addQty" label="Количество" type="number" min={1} max={20} defaultValue={1} />
              </div>
              <FormField name="reason" label="Причина изменения" maxLength={500} required />
              <button type="submit" className="ak-btn">Применить</button>
            </form>
          ) : null}

          <section className="ak-card" aria-labelledby="o-comments">
            <h2 id="o-comments">Внутренние комментарии</h2>
            <p className="ak-muted">Покупатель их не видит.</p>
            {comments.length === 0 ? <p className="ak-muted">Комментариев пока нет.</p> : null}
            <ul className="ak-list">
              {comments.map((c) => (
                <li key={c.id}>
                  <strong>{c.authorName ?? 'Сотрудник'}</strong> · {fmtTime(c.createdAt)}
                  <br />
                  {c.body}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <form action={addNoteAction}>
                {hidden}
                <TextAreaField name="note" label="Новый комментарий" rows={3} maxLength={500} required />
                <button type="submit" className="ak-btn">Добавить</button>
              </form>
            ) : null}
          </section>

          <section className="ak-card" aria-labelledby="o-history">
            <h2 id="o-history">История изменений</h2>
            <ol className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="timeline__time">{fmtTime(e.at)}</span> —{' '}
                  {e.kind === 'status' || e.kind === 'revert'
                    ? `${e.kind === 'revert' ? 'возврат на шаг: ' : ''}${e.fromStatus ? STATUS_LABELS[e.fromStatus] : '—'} → ${e.toStatus ? STATUS_LABELS[e.toStatus] : '—'}`
                    : (EVENT_TEXT[e.kind] ?? e.kind)}{' '}
                  ({actor(e.actorType, e.actorId)}){e.note && e.kind !== 'note' ? `: ${e.note}` : ''}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="ak-stack">
          <section className="ak-card" aria-labelledby="o-pay">
            <h2 id="o-pay">Оплата</h2>
            <p>
              {pay.paymentName}: <strong>{pay.isPaid ? 'оплачен' : 'не оплачен'}</strong>
            </p>
            <p className="ak-muted">Платёжный провайдер: {pay.providerConnected ? pay.provider : 'не подключён'}. {pay.providerNote ?? ''}</p>
            {canWrite && !pay.isPaid && pay.paymentKind !== 'online' && order.status !== 'cancelled' && order.status !== 'refunded' ? (
              <form action={markPaidAction}>
                {hidden}
                <h3>Отметить оплаченным</h3>
                <p className="ak-muted">Для оплаты при получении или вне системы. Действие попадёт в журнал. Онлайн-оплата подтверждается только платёжной системой.</p>
                <TextAreaField name="comment" label="Комментарий (обязательно)" rows={2} maxLength={500} required />
                <label>
                  <input type="checkbox" name="confirm" required /> Подтверждаю, что оплата получена
                </label>
                <div>
                  <button type="submit" className="ak-btn">Отметить оплаченным</button>
                </div>
              </form>
            ) : null}
            {canRefund && order.isPaid ? (
              pay.refundAvailable ? (
                <form action={refundOrderAction}>
                  {hidden}
                  <h3>Возврат средств</h3>
                  <p className="ak-muted">{pay.refundNote}</p>
                  <FormField name="note" label="Комментарий" maxLength={500} />
                  <button type="submit" className="ak-btn ak-btn--danger-outline">Вернуть деньги</button>
                </form>
              ) : (
                <p className="ak-muted">Возврат средств: {pay.refundNote}</p>
              )
            ) : null}
          </section>

          {canWrite ? (
            <>
              {nextStatuses.length > 0 ? (
                <form action={changeStatusAction} className="ak-card">
                  {hidden}
                  <h2>Сменить статус</h2>
                  <SelectField name="status" label="Новый статус" options={nextStatuses.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} required />
                  <FormField name="note" label="Комментарий (необязательно)" maxLength={500} />
                  <button type="submit" className="ak-btn ak-btn--primary">Сменить статус</button>
                </form>
              ) : null}
              {revertTo.length > 0 ? (
                <form action={revertStatusAction} className="ak-card">
                  {hidden}
                  <h2>Вернуть на предыдущий шаг</h2>
                  <p className="ak-muted">Исправление ошибки: история сохраняется, причина обязательна.</p>
                  <SelectField name="status" label="Вернуть в статус" options={revertTo.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} required />
                  <FormField name="note" label="Причина" maxLength={500} required />
                  <button type="submit" className="ak-btn">Вернуть</button>
                </form>
              ) : null}
              <form action={assignOrderAction} className="ak-card">
                {hidden}
                <h2>Ответственный</h2>
                <SelectField name="staffId" label="Менеджер" defaultValue={order.assignedStaffId ? String(order.assignedStaffId) : ''} placeholder="Не назначен" options={staff.map((s) => ({ value: String(s.id), label: s.label }))} />
                <button type="submit" className="ak-btn">Назначить</button>
              </form>
              {canCancel ? (
                <form action={cancelOrderAction} className="ak-card">
                  {hidden}
                  <h2>Отмена заказа</h2>
                  <FormField name="note" label="Причина" maxLength={500} />
                  <button type="submit" className="ak-btn ak-btn--danger-outline">Отменить заказ</button>
                </form>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
