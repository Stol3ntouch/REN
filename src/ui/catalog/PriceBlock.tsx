import { formatPrice } from '@/domain/catalog/format';

/** Цена к оплате; старая — только при реальной скидочной цене (без бейджей и процентов «от себя»). */
export function PriceBlock({ unitKopecks, originalKopecks, size = 'md' }: { unitKopecks: number; originalKopecks?: number; size?: 'md' | 'lg' }) {
  return (
    <p className={`price price--${size}`}>
      <span className="price__current">{formatPrice(unitKopecks)}</span>
      {originalKopecks !== undefined ? (
        <>
          <span className="visually-hidden"> Старая цена: </span>
          <s className="price__old">{formatPrice(originalKopecks)}</s>
        </>
      ) : null}
    </p>
  );
}
