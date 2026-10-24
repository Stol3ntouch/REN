import Link from 'next/link';
import type { ProductCard as ProductCardData } from '@/domain/catalog/types';
import { AddToCartButton } from './AddToCartButton';
import { PriceBlock } from './PriceBlock';
import { ProductImage } from './ProductImage';
import { CardActionsSlot } from './slots';

export function productHref(slug: string): string {
  return `/product/${slug}`;
}

/** Карточка в сетке. Слот кнопок T07 — CardActionsSlot (поверх фото). */
export function ProductCard({ product, priority = false }: { product: ProductCardData; priority?: boolean }) {
  const href = productHref(product.slug);
  return (
    <article className="product-card" data-product-id={product.id}>
      <div className="product-card__media">
        <Link href={href} tabIndex={-1} aria-hidden="true" className="product-card__image-link">
          <ProductImage image={product.image} name={product.name} priority={priority} sizes="(min-width: 64rem) 16rem, 50vw" />
        </Link>
        <div className="product-card__actions">
          <CardActionsSlot product={product} />
        </div>
      </div>
      <h3 className="product-card__title">
        <Link href={href} title={product.name}>
          {product.name}
        </Link>
      </h3>
      <p className="product-card__sku" aria-hidden={product.sku ? undefined : true}>
        {product.sku ? `Артикул: ${product.sku}` : ''}
      </p>
      <div className="product-card__buy">
        <PriceBlock unitKopecks={product.unitKopecks} originalKopecks={product.originalKopecks} />
        <AddToCartButton productId={product.id} inStock={product.inStock} name={product.name} compact />
      </div>
    </article>
  );
}
