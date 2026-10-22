import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getSession, resolveOwner } from '@/domain/customers/session';
import { cart, checkout } from '@/domain/ordering';
import { formatRub } from '@/domain/pricing/format';
import '@/ui/cart/cart.css';
import { EmptyState, ErrorState } from '@/ui/states';
import { acknowledgeChangesAction } from '../cart/actions';
import { CheckoutForm } from './CheckoutForm';

export const metadata: Metadata = { title: 'Оформление заказа', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const jar = await cookies();
  const owner = resolveOwner(jar);
  const view = cart.get(owner);

  if (!owner || view.items.length === 0) {
    return (
      <div className="checkout-page container">
        <h1>Оформление заказа</h1>
        <EmptyState title="Корзина пуста">
          <p>
            Добавьте товары из <Link href="/catalog">каталога</Link>, чтобы оформить заказ.
          </p>
        </EmptyState>
      </div>
    );
  }

  const check = await checkout.validate(view.cartId, owner);
  if (!check.ok) {
    return (
      <div className="checkout-page container">
        <h1>Оформление заказа</h1>
        <ErrorState title="Перед оформлением проверьте изменения в корзине">
          <ul className="changes">
            {check.changes.map((c, i) => (
              <li key={i}>
                {c.kind === 'price_changed'
                  ? `«${c.name}»: цена изменилась с ${formatRub(c.oldUnitKopecks)} на ${formatRub(c.newUnitKopecks)} за шт.`
                  : c.kind === 'unavailable'
                    ? `«${c.name}»: ${c.reason === 'out_of_stock' ? 'нет в наличии' : 'больше не продаётся'}.`
                    : c.message}
              </li>
            ))}
          </ul>
          <form action={acknowledgeChangesAction}>
            <button type="submit" className="button">
              Принять изменения
            </button>
          </form>
        </ErrorState>
      </div>
    );
  }

  const methods = checkout.methods();
  if (methods.delivery.length === 0 || methods.payment.length === 0) {
    return (
      <div className="checkout-page container">
        <h1>Оформление заказа</h1>
        <ErrorState title="Оформление временно недоступно">
          <p>Способы получения или оплаты не настроены. Свяжитесь с магазином по телефону.</p>
        </ErrorState>
      </div>
    );
  }

  return (
    <div className="checkout-page container">
      <h1>Оформление заказа</h1>
      <CheckoutForm
        delivery={methods.delivery.map((d) => ({ id: d.id, name: d.name, description: d.description, priceKopecks: d.priceKopecks, requiresAddress: d.requiresAddress }))}
        payment={methods.payment.map((p) => ({ id: p.id, name: p.name, description: p.description }))}
        idempotencyKey={randomUUID()}
        defaultEmail={getSession(jar)?.email ?? ''}
        totals={{ subtotalKopecks: view.subtotalKopecks, discountKopecks: view.discountKopecks, promoCode: view.promo?.code ?? null, totalKopecks: view.totalKopecks }}
      />
    </div>
  );
}
