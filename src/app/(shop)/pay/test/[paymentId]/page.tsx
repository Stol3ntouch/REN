import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRub } from '@/domain/pricing/format';
import { loadTestPayment } from '@/integrations/payment/test-pay';
import '@/ui/cart/cart.css';
import { EmptyState } from '@/ui/states';
import './pay.css';
import { testPayAction } from './actions';

// Страница закрыта от поисковиков и не отдаёт Referer (в адресе подписанный токен заказа).
export const metadata: Metadata = { title: 'Тестовая оплата', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ paymentId: string }>; searchParams: Promise<{ t?: string }> };

export default async function TestPayPage({ params, searchParams }: Props) {
  const [{ paymentId }, sp] = await Promise.all([params, searchParams]);
  const token = typeof sp.t === 'string' ? sp.t : null;
  const ctx = await loadTestPayment(decodeURIComponent(paymentId), token);
  if (!ctx) notFound();
  const { payment, order } = ctx;
  const orderHref = payment.returnUrl ?? `/order/${encodeURIComponent(order.number)}`;

  return (
    <div className="pay-page container">
      <p className="pay-banner" role="note">
        ТЕСТОВАЯ ОПЛАТА
      </p>
      <h1>Оплата заказа {order.number}</h1>
      <p className="pay-note">Это проверочная страница: деньги не списываются, данные карты не запрашиваются. Результат придёт на сайт сообщением от платёжной системы.</p>
      <p className="pay-amount">
        К оплате: <strong>{formatRub(payment.amountKopecks)}</strong>
      </p>

      {payment.status === 'pending' ? (
        <form action={testPayAction} className="pay-actions">
          <input type="hidden" name="paymentId" value={payment.externalId} />
          <input type="hidden" name="t" value={token ?? ''} />
          <button type="submit" name="outcome" value="success" className="button">
            Успешно
          </button>
          <button type="submit" name="outcome" value="failure" className="button button--outline">
            Отказ
          </button>
        </form>
      ) : (
        <EmptyState title="Платёж уже обработан">
          <p>
            Статус смотрите на <Link href={orderHref}>странице заказа</Link>.
          </p>
        </EmptyState>
      )}
      <p>
        <Link href={orderHref}>Вернуться к заказу</Link>
      </p>
    </div>
  );
}
