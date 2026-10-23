'use client';

import { CompareButton } from '@/ui/compare/CompareButton';
import { FavoriteButton } from '@/ui/favorite/FavoriteButton';

/*
 * Слоты T07: кнопки избранного и сравнения. Файл клиентский: ProductCard используется и в клиентских сетках.
 */

/** Кнопки поверх фото карточки в сетке (правый верхний угол). */
export function CardActionsSlot({ product }: { product: { id: number; name: string } }) {
  return (
    <>
      <FavoriteButton productId={product.id} name={product.name} variant="icon" />
      <CompareButton productId={product.id} name={product.name} variant="icon" />
    </>
  );
}

/** Кнопки рядом с «В корзину» на странице товара. */
export function ProductActionsSlot({ product }: { product: { id: number; name: string } }) {
  return (
    <>
      <FavoriteButton productId={product.id} name={product.name} variant="text" />
      <CompareButton productId={product.id} name={product.name} variant="text" />
    </>
  );
}
