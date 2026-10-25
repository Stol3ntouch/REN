import { formatPrice } from '@/domain/catalog/format';
import { discountPercent } from '@/domain/catalog/price-display';
import { PricesOnly } from '@/ui/layout/prices-context';

/** Цена к оплате; старая — только при реальной скидочной цене (без бейджей и процентов «от себя»). */
export function PriceBlock({ unitKopecks, originalKopecks, size = 'md' }: { unitKopecks: number; originalKopecks?: number; size?: 'md' | 'lg' }) {
  // «Показывать цены» выключен: цены не выводятся (PricesOnly; расчёты на сервере остаются).
  const percent = discountPercent(unitKopecks, originalKopecks); // «−N %» только от реальной старой цены
  return (
    <PricesOnly>
    <p className={`price price--${size}`}>
      <span className="price__current">{formatPrice(unitKopecks)}</span>
      {originalKopecks !== undefined ? (
        <>
          <span className="visually-hidden"> Старая цена: </span>
          <s className="price__old">{formatPrice(originalKopecks)}</s>
          {percent !== null ? <span className="price__discount">−{percent}&nbsp;%</span> : null}
        </>
      ) : null}
    </p>
    </PricesOnly>
  );
}
