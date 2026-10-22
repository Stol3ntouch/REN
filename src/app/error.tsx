'use client';

import { ErrorState } from '@/ui/states';

/** Граница ошибок для страниц: без деталей исключения, с кнопкой «Повторить». */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="container" style={{ paddingBlock: '2rem' }}>
      <h1>Ошибка</h1>
      <ErrorState title="Не удалось показать страницу">
        <p>Попробуйте обновить страницу немного позже.</p>
        <button className="button" type="button" onClick={() => reset()}>
          Повторить
        </button>
      </ErrorState>
    </main>
  );
}
