'use client';

import { useActionState, useRef, useState, useSyncExternalStore } from 'react';
import { formatRub } from '@/domain/pricing/format';
import { Totals } from '@/ui/cart/Totals';
import { CART_IDLE } from '@/ui/cart/state';
import { ErrorState } from '@/ui/states';
import { acknowledgeChangesAction } from '../cart/actions';
import { placeOrderAction } from './actions';

export type MethodOption = { id: number; name: string; description: string | null };
export type DeliveryOption = MethodOption & { priceKopecks: number | null; requiresAddress: boolean };

type Props = {
  delivery: DeliveryOption[];
  payment: MethodOption[];
  idempotencyKey: string;
  defaultEmail: string;
  totals: { subtotalKopecks: number; discountKopecks: number; promoCode: string | null; totalKopecks: number };
};

/**
 * Оформление в два шага (эталон: «Контакты и получение» → «Проверка и подтверждение»).
 * Без JS оба шага видны на одной странице и форма отправляется целиком.
 */
export function CheckoutForm({ delivery, payment, idempotencyKey, defaultEmail, totals }: Props) {
  const [state, action, pending] = useActionState(placeOrderAction, CART_IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  // До гидратации (и без JS) step = 0: оба шага видны, форма отправляется целиком.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [stepState, setStep] = useState<1 | 2>(1);
  const step: 0 | 1 | 2 = hydrated ? stepState : 0;
  const [deliveryId, setDeliveryId] = useState<number>(delivery[0]?.id ?? 0);
  const [paymentId, setPaymentId] = useState<number>(payment[0]?.id ?? 0);
  const [review, setReview] = useState<Record<string, string>>({});

  const selectedDelivery = delivery.find((d) => d.id === deliveryId);
  const selectedPayment = payment.find((p) => p.id === paymentId);
  const fieldError = (name: string) => state.fields?.[name] ?? state.fields?.[`contact.${name}`];

  function goReview() {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const data = new FormData(form);
    setReview({ name: String(data.get('name') ?? ''), email: String(data.get('email') ?? ''), phone: String(data.get('phone') ?? ''), address: String(data.get('address') ?? ''), comment: String(data.get('comment') ?? '') });
    setStep(2);
  }

  const show1 = step !== 2;
  const show2 = step !== 1;

  return (
    <form ref={formRef} action={action} className="checkout-layout" noValidate={false}>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <ol className="steps" aria-label="Шаги оформления">
          <li aria-current={step !== 2 ? 'step' : undefined}>1. Контакты и получение</li>
          <li aria-current={step === 2 ? 'step' : undefined}>2. Проверка и подтверждение</li>
        </ol>

        {state.status === 'error' && state.message ? (
          <ErrorState title={state.changes ? 'Заказ не оформлен: в корзине есть изменения' : 'Не получилось оформить заказ'}>
            <p>{state.message}</p>
            {state.changes ? (
              <>
                <ul className="changes">
                  {state.changes.map((c, i) => (
                    <li key={i}>
                      {c.kind === 'price_changed'
                        ? `«${c.name}»: цена изменилась с ${formatRub(c.oldUnitKopecks)} на ${formatRub(c.newUnitKopecks)} за шт.`
                        : c.kind === 'unavailable'
                          ? `«${c.name}»: ${c.reason === 'out_of_stock' ? 'нет в наличии' : 'больше не продаётся'}.`
                          : c.message}
                    </li>
                  ))}
                </ul>
                <button type="submit" formAction={acknowledgeChangesAction} formNoValidate className="button">
                  Принять изменения
                </button>
              </>
            ) : null}
          </ErrorState>
        ) : null}

        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <div className="trap" aria-hidden="true">
          <label htmlFor="co-website">Не заполняйте это поле</label>
          <input id="co-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <div hidden={!show1} style={{ display: show1 ? 'grid' : 'none', gap: 'var(--space-4)' }}>
          <fieldset className="fieldset">
            <legend>Контакты</legend>
            <div className="field">
              <label htmlFor="co-name">Имя</label>
              <input id="co-name" name="name" type="text" autoComplete="name" required minLength={2} maxLength={100} aria-invalid={fieldError('name') ? true : undefined} />
              {fieldError('name') ? <p className="field__error">{fieldError('name')![0]}</p> : null}
            </div>
            <div className="field">
              <label htmlFor="co-email">Email</label>
              <input id="co-email" name="email" type="email" autoComplete="email" required defaultValue={defaultEmail} aria-invalid={fieldError('email') ? true : undefined} />
              {fieldError('email') ? <p className="field__error">{fieldError('email')![0]}</p> : null}
            </div>
            <div className="field">
              <label htmlFor="co-phone">Телефон</label>
              <input id="co-phone" name="phone" type="tel" autoComplete="tel" required placeholder="+7 900 000-00-00" aria-invalid={fieldError('phone') ? true : undefined} />
              {fieldError('phone') ? <p className="field__error">{fieldError('phone')![0]}</p> : null}
            </div>
          </fieldset>

          <fieldset className="fieldset">
            <legend>Получение</legend>
            {delivery.map((d) => (
              <label key={d.id} className="option">
                <input type="radio" name="deliveryMethodId" value={d.id} checked={deliveryId === d.id} onChange={() => setDeliveryId(d.id)} required />
                <span className="option__text">
                  <span>{d.name}</span>
                  <span className="option__hint">
                    {d.priceKopecks === null ? 'Стоимость рассчитает менеджер' : d.priceKopecks === 0 ? 'Бесплатно' : formatRub(d.priceKopecks)}
                    {d.description ? ` · ${d.description}` : ''}
                  </span>
                </span>
              </label>
            ))}
            {fieldError('deliveryMethodId') ? <p className="field__error">{fieldError('deliveryMethodId')![0]}</p> : null}
            <div className="field" hidden={step !== 0 && !selectedDelivery?.requiresAddress}>
              <label htmlFor="co-address">Адрес доставки{selectedDelivery?.requiresAddress ? '' : ' (если нужна доставка)'}</label>
              <input id="co-address" name="address" type="text" autoComplete="street-address" maxLength={300} required={Boolean(selectedDelivery?.requiresAddress)} aria-invalid={fieldError('address') ? true : undefined} />
              {fieldError('address') ? <p className="field__error">{fieldError('address')![0]}</p> : null}
            </div>
          </fieldset>

          <fieldset className="fieldset">
            <legend>Оплата</legend>
            {payment.map((p) => (
              <label key={p.id} className="option">
                <input type="radio" name="paymentMethodId" value={p.id} checked={paymentId === p.id} onChange={() => setPaymentId(p.id)} required />
                <span className="option__text">
                  <span>{p.name}</span>
                  {p.description ? <span className="option__hint">{p.description}</span> : null}
                </span>
              </label>
            ))}
            {fieldError('paymentMethodId') ? <p className="field__error">{fieldError('paymentMethodId')![0]}</p> : null}
          </fieldset>

          <div className="field">
            <label htmlFor="co-comment">Комментарий к заказу (необязательно)</label>
            <textarea id="co-comment" name="comment" rows={3} maxLength={1000} />
          </div>

          {step === 1 ? (
            <div className="checkout-actions">
              <button type="button" className="button" onClick={goReview}>
                Далее: проверить заказ
              </button>
            </div>
          ) : null}
        </div>

        <div style={{ display: show2 ? 'grid' : 'none', gap: 'var(--space-4)' }}>
          {step === 2 ? (
            <section className="fieldset" aria-label="Проверьте данные">
              <h2>Проверьте данные</h2>
              <p>
                {review.name}, {review.email}, {review.phone}
              </p>
              <p>
                Получение: {selectedDelivery?.name}
                {review.address ? ` — ${review.address}` : ''}
              </p>
              <p>Оплата: {selectedPayment?.name}</p>
              {review.comment ? <p>Комментарий: {review.comment}</p> : null}
            </section>
          ) : null}

          <label className="option">
            <input type="checkbox" name="consent" required />
            <span className="option__text">
              <span>Согласен на обработку персональных данных для оформления и выполнения заказа</span>
              {fieldError('consent') ? <span className="field__error">{fieldError('consent')![0]}</span> : null}
            </span>
          </label>

          <div className="checkout-actions">
            {step === 2 ? (
              <button type="button" className="button button--outline" onClick={() => setStep(1)}>
                Назад
              </button>
            ) : null}
            <button type="submit" className="button" disabled={pending}>
              {pending ? 'Оформляем…' : 'Подтвердить заказ'}
            </button>
          </div>
        </div>
      </div>

      <aside>
        <Totals
          title="Ваш заказ"
          subtotalKopecks={totals.subtotalKopecks}
          discountKopecks={totals.discountKopecks}
          promoCode={totals.promoCode}
          delivery={selectedDelivery ? { name: selectedDelivery.name, kopecks: selectedDelivery.priceKopecks, pending: selectedDelivery.priceKopecks === null } : null}
          totalKopecks={totals.totalKopecks + (selectedDelivery?.priceKopecks ?? 0)}
        />
      </aside>
    </form>
  );
}
