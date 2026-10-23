'use client';

import { CollectionButton } from '@/ui/favorite/CollectionButton';

const BARS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" focusable="false">
    <path d="M6 20V10M12 20V4M18 20v-7" />
  </svg>
);

/** Кнопка «В сравнение»: aria-pressed, подпись «Сравнение: <товар>». Лимит 4 — сообщение сервера показывается рядом. */
export function CompareButton({ productId, name, variant = 'icon' }: { productId: number; name: string; variant?: 'icon' | 'text' }) {
  return (
    <CollectionButton
      kind="compare"
      productId={productId}
      name={name}
      label="Сравнение"
      idleText="В сравнение"
      pressedText="В сравнении"
      icon={BARS}
      variant={variant}
    />
  );
}
