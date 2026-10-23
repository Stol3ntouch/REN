'use client';

import { CollectionButton } from './CollectionButton';

const HEART = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" focusable="false">
    <path d="M12 20.5s-7.5-4.6-9.2-9.6C1.7 7.6 3.7 4.5 7 4.5c2 0 3.7 1.1 5 3 1.3-1.9 3-3 5-3 3.3 0 5.3 3.1 4.2 6.4-1.7 5-9.2 9.6-9.2 9.6z" />
  </svg>
);

/** Кнопка «В избранное»: aria-pressed, подпись «Избранное: <товар>». variant icon — на карточке, text — на странице товара. */
export function FavoriteButton({ productId, name, variant = 'icon' }: { productId: number; name: string; variant?: 'icon' | 'text' }) {
  return (
    <CollectionButton
      kind="favorites"
      productId={productId}
      name={name}
      label="Избранное"
      idleText="В избранное"
      pressedText="В избранном"
      icon={HEART}
      variant={variant}
    />
  );
}
