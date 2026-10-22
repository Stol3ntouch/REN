'use client';

import { ErrorState } from '@/ui/states';

/** Ошибка загрузки каталога: сообщение и кнопка «Повторить» (перерисовывает сегмент). */
export function CatalogError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState title="Не удалось загрузить каталог">
      <p>Что-то пошло не так на нашей стороне. Попробуйте ещё раз.</p>
      <button type="button" className="button" onClick={() => reset()}>
        Повторить
      </button>
    </ErrorState>
  );
}
