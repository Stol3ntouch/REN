/*
 * Слоты для T07 (избранное, сравнение). Заглушки ничего не рисуют; T07 заменяет тело
 * этих двух компонентов кнопками (они станут 'use client': ProductCard используется и на клиенте).
 */

/** Кнопки поверх фото карточки в сетке (правый верхний угол). */
export function CardActionsSlot({ product }: { product: { id: number; name: string } }) {
  void product;
  return null;
}

/** Кнопки рядом с «В корзину» на странице товара. */
export function ProductActionsSlot({ product }: { product: { id: number; name: string } }) {
  void product;
  return null;
}
