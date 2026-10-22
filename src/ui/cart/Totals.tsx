import { formatRub } from '@/domain/pricing/format';
import type { ReactNode } from 'react';

export type TotalsProps = {
  title?: string;
  subtotalKopecks: number;
  discountKopecks: number;
  promoCode?: string | null;
  /** undefined — доставка ещё не выбрана; pending — рассчитает менеджер. */
  delivery?: { name: string; kopecks: number | null; pending: boolean } | null;
  totalKopecks: number;
  children?: ReactNode;
};

/** Итоги заказа: все суммы приходят уже посчитанными сервером. Стоимость доставки «по согласованию» — без цифр. */
export function Totals({ title = 'Итого', subtotalKopecks, discountKopecks, promoCode, delivery, totalKopecks, children }: TotalsProps) {
  return (
    <section className="summary" aria-label={title}>
      <h2>{title}</h2>
      <p className="summary__row">
        <span>Товары</span>
        <span>{formatRub(subtotalKopecks)}</span>
      </p>
      {discountKopecks > 0 ? (
        <p className="summary__row">
          <span>Скидка{promoCode ? ` (${promoCode})` : ''}</span>
          <span>−{formatRub(discountKopecks)}</span>
        </p>
      ) : null}
      {delivery ? (
        <p className="summary__row">
          <span>{delivery.name}</span>
          <span>{delivery.pending ? 'рассчитает менеджер' : formatRub(delivery.kopecks ?? 0)}</span>
        </p>
      ) : null}
      <p className="summary__row summary__row--total">
        <span>К оплате</span>
        <span>{formatRub(totalKopecks)}</span>
      </p>
      {delivery?.pending ? <p className="summary__hint">Стоимость доставки не входит в сумму: её рассчитает менеджер и сообщит вам.</p> : null}
      {children}
    </section>
  );
}
