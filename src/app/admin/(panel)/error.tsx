'use client';

import Link from 'next/link';
import { ErrorState } from '@/ui/admin/kit/ErrorState';

/** Граница ошибок админки: без внутренних деталей (только код для журнала сервера), с действиями «Повторить» и «На главную». */
export default function AdminError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  const again = retry ?? reset;
  return (
    <div className="ak-card">
      <ErrorState
        title="Не удалось показать страницу"
        action={
          <span className="ak-pagehead__actions">
            {again ? (
              <button type="button" className="ak-btn ak-btn--primary" onClick={() => again()}>
                Повторить
              </button>
            ) : null}
            <Link href="/admin" className="ak-btn ak-btn--outline">
              На главную
            </Link>
          </span>
        }
      >
        <p>Что-то пошло не так на нашей стороне. Попробуйте ещё раз; если ошибка повторяется, сообщите администратору.</p>
        {error.digest ? <p>Код ошибки для разработчика: {error.digest}</p> : null}
      </ErrorState>
    </div>
  );
}
