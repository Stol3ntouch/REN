'use client';

import Link from 'next/link';
import { useFormStatus } from 'react-dom';

/**
 * Панель сохранения формы: «Сохранить изменения» и «Отмена». Стоит ВНУТРИ <form>: во время отправки (server action)
 * кнопки блокируются сами (useFormStatus), повторная отправка невозможна. Для формы на useActionState передайте `pending`.
 * «Отмена» — ссылка (`cancelHref`) или сброс полей формы.
 */
export function SaveBar({
  saveLabel = 'Сохранить изменения',
  cancelLabel = 'Отмена',
  cancelHref,
  pending,
  dirty,
  sticky = true,
}: {
  saveLabel?: string;
  cancelLabel?: string;
  cancelHref?: string;
  pending?: boolean;
  /** true — показать «Есть несохранённые изменения». */
  dirty?: boolean;
  sticky?: boolean;
}) {
  const status = useFormStatus();
  const busy = pending ?? status.pending;
  return (
    <div className={`ak-savebar${sticky ? ' ak-savebar--sticky' : ''}`}>
      <p className="ak-savebar__note" role="status" aria-live="polite">
        {busy ? 'Сохранение…' : dirty ? 'Есть несохранённые изменения' : ''}
      </p>
      <div className="ak-savebar__actions">
        {cancelHref ? (
          <Link href={cancelHref} className="ak-btn ak-btn--outline" aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined} prefetch={false}>
            {cancelLabel}
          </Link>
        ) : (
          <button type="reset" className="ak-btn ak-btn--outline" disabled={busy}>
            {cancelLabel}
          </button>
        )}
        <button type="submit" className="ak-btn ak-btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Сохранение…' : saveLabel}
        </button>
      </div>
    </div>
  );
}
