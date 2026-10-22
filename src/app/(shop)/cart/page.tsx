import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { resolveOwner } from '@/domain/customers/session';
import { cart } from '@/domain/ordering';
import { formatRub } from '@/domain/pricing/format';
import '@/ui/cart/cart.css';
import { Totals } from '@/ui/cart/Totals';
import { EmptyState, ErrorState } from '@/ui/states';
import { PromoForm } from './PromoForm';
import { acknowledgeChangesAction, changeQtyAction, removeItemAction } from './actions';

export const metadata: Metadata = { title: 'Корзина', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const owner = resolveOwner(await cookies());
  const view = cart.get(owner);
  const changes = cart.changes(owner);

  if (view.items.length === 0) {
    return (
      <div className="cart-page container">
        <h1>Корзина</h1>
        <EmptyState title="В корзине пока ничего нет">
          <p>
            Выберите товары в <Link href="/catalog">каталоге</Link>.
          </p>
        </EmptyState>
      </div>
    );
  }

  const hasUnavailable = view.items.some((i) => !i.available);

  return (
    <div className="cart-page container">
      <h1>Корзина</h1>

      {changes.length > 0 ? (
        <ErrorState title="В корзине есть изменения">
          <ul className="changes">
            {changes.map((c, i) => (
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
      ) : null}

      <div className="cart-layout">
        <ul className="cart-list" aria-label="Товары в корзине">
          {view.items.map((line) => (
            <li key={line.productId} className={`cart-line${line.available ? '' : ' cart-line--unavailable'}`}>
              {line.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- внешний URL фида; локальные копии подключит витрина
                <img className="cart-line__image" src={line.imageUrl} alt={line.name} width={72} height={72} loading="lazy" />
              ) : (
                <div className="cart-line__image cart-line__image--empty" aria-hidden="true">
                  нет фото
                </div>
              )}
              <div>
                <p className="cart-line__title">
                  <Link href={`/product/${line.slug}`}>{line.name}</Link>
                </p>
                {line.sku ? <p className="cart-line__sku">Артикул: {line.sku}</p> : null}
                <p className="price">
                  {line.originalKopecks ? <span className="price__old">{formatRub(line.originalKopecks)}</span> : null}
                  {formatRub(line.unitKopecks)}
                </p>
                {!line.available ? <p className="cart-line__note">Нет в наличии — уберите позицию или примите изменения.</p> : null}
              </div>
              <div className="cart-line__controls">
                <div className="qty" role="group" aria-label={`Количество: ${line.name}`}>
                  <form action={changeQtyAction}>
                    <input type="hidden" name="productId" value={line.productId} />
                    <input type="hidden" name="qty" value={line.qty - 1} />
                    <button type="submit" aria-label="Уменьшить количество" disabled={line.qty <= 1}>
                      −
                    </button>
                  </form>
                  <span className="qty__value" aria-live="polite">
                    {line.qty}
                  </span>
                  <form action={changeQtyAction}>
                    <input type="hidden" name="productId" value={line.productId} />
                    <input type="hidden" name="qty" value={line.qty + 1} />
                    <button type="submit" aria-label="Увеличить количество" disabled={line.qty >= 20}>
                      +
                    </button>
                  </form>
                </div>
                <p className="price" aria-label="Сумма по позиции">
                  {line.available ? formatRub(line.lineKopecks) : '—'}
                </p>
                <form action={removeItemAction}>
                  <input type="hidden" name="productId" value={line.productId} />
                  <button type="submit" className="link-button">
                    Убрать
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>

        <aside>
          <Totals subtotalKopecks={view.subtotalKopecks} discountKopecks={view.discountKopecks} promoCode={view.promo?.code} totalKopecks={view.totalKopecks}>
            <PromoForm appliedCode={view.promo?.code ?? null} />
            {view.promoError ? <p className="field__error">{view.promoError}</p> : null}
            <p className="summary__hint">Не больше 20 шт. одной позиции. Способ получения и оплаты — на следующем шаге.</p>
            {hasUnavailable || changes.length > 0 ? (
              <p className="summary__hint">Чтобы оформить заказ, примите изменения в корзине.</p>
            ) : (
              <Link href="/checkout" className="button">
                Оформить заказ
              </Link>
            )}
          </Totals>
        </aside>
      </div>
    </div>
  );
}
