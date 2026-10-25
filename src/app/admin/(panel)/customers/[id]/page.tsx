import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { STATUS_LABELS, isOrderStatus } from '@/domain/ordering/status';
import { formatRub } from '@/domain/pricing/format';
import { requireStaffPage } from '@/ui/admin/guard';
import { FlashToast, PageHeader, SelectField, TextAreaField } from '@/ui/admin/kit';
import { CUSTOMER_STATUS_LABELS, customersOps } from '../../_lib/customers-ops';
import { fmtTime } from '../../_lib/ui';
import { addCustomerNoteAction, setCustomerStatusAction } from '../actions';

export const metadata: Metadata = { title: 'Клиент' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function AdminCustomerPage({ params, searchParams }: Props) {
  const session = await requireStaffPage('customers.read');
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const profile = Number.isInteger(Number(id)) ? customersOps.get(session, Number(id)) : null;
  if (!profile) notFound();
  const { user, orders, addresses, consents, notes } = profile;
  const canWrite = hasPermission(session, 'customers.write');

  return (
    <>
      <FlashToast ok={sp.ok} error={sp.error} />
      <p>
        <Link href="/admin/customers">← Все клиенты</Link>
      </p>
      <PageHeader title={user.name ?? user.email} description={`Статус: ${CUSTOMER_STATUS_LABELS[user.status]}`} />
      <div className="ak-grid-2">
        <div className="ak-stack">
          <section className="ak-card" aria-labelledby="c-profile">
            <h2 id="c-profile">Профиль</h2>
            <dl>
              <dt>Email</dt>
              <dd>{user.email}</dd>
              <dt>Телефон</dt>
              <dd>{user.phone ?? '—'}</dd>
              <dt>Зарегистрирован</dt>
              <dd>{fmtTime(user.createdAt)}</dd>
              <dt>Последний вход</dt>
              <dd>{user.lastLoginAt ? fmtTime(user.lastLoginAt) : '—'}</dd>
              <dt>Заказов / сумма покупок</dt>
              <dd>
                {user.ordersCount} / {formatRub(user.spentKopecks)}
              </dd>
            </dl>
          </section>
          <section className="ak-card" aria-labelledby="c-addr">
            <h2 id="c-addr">Адреса</h2>
            {addresses.length === 0 ? <p className="ak-muted">Адресов нет.</p> : <ul>{addresses.map((a) => <li key={a.id}>{a.label ? `${a.label}: ` : ''}{a.address}</li>)}</ul>}
          </section>
          <section className="ak-card" aria-labelledby="c-consents">
            <h2 id="c-consents">Согласия</h2>
            {consents.length === 0 ? <p className="ak-muted">Согласий нет.</p> : <ul>{consents.map((c) => <li key={c.id}>{c.kind} — {c.source}, {fmtTime(c.grantedAt)}</li>)}</ul>}
          </section>
          <section className="ak-card" aria-labelledby="c-orders">
            <h2 id="c-orders">История заказов</h2>
            {orders.length === 0 ? (
              <p className="ak-muted">Заказов пока нет.</p>
            ) : (
              <ul>
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/orders/${o.number}`}>{o.number}</Link> · {fmtTime(o.createdAt)} · {isOrderStatus(o.status) ? STATUS_LABELS[o.status] : o.status} · {formatRub(o.totalKopecks)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="ak-stack">
          {canWrite ? (
            <form action={setCustomerStatusAction} className="ak-card">
              <input type="hidden" name="id" value={user.id} />
              <h2>Статус клиента</h2>
              <SelectField
                name="status"
                label="Статус"
                defaultValue={user.status}
                options={(Object.keys(CUSTOMER_STATUS_LABELS) as Array<keyof typeof CUSTOMER_STATUS_LABELS>).map((s) => ({ value: s, label: CUSTOMER_STATUS_LABELS[s] }))}
                hint="«Заблокирован» закрывает вход и оформление заказов"
              />
              <button type="submit" className="ak-btn ak-btn--primary">
                Сохранить
              </button>
            </form>
          ) : null}
          <section className="ak-card" aria-labelledby="c-notes">
            <h2 id="c-notes">Комментарии менеджера</h2>
            {notes.length === 0 ? <p className="ak-muted">Заметок нет.</p> : null}
            <ul className="ak-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <strong>{n.authorName ?? 'Сотрудник'}</strong> · {fmtTime(n.createdAt)}
                  <br />
                  {n.body}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <form action={addCustomerNoteAction}>
                <input type="hidden" name="id" value={user.id} />
                <TextAreaField name="body" label="Новая заметка" rows={3} maxLength={1000} required />
                <button type="submit" className="ak-btn">
                  Добавить
                </button>
              </form>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}
