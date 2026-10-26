'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { downloadLinkAction, requestRestoreAction, type LinkState } from './actions';

const IDLE: LinkState = { status: 'idle' };

/** Пока копия создаётся, страница сама обновляется раз в 2 секунды. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function DownloadForm({ id }: { id: number }) {
  const [state, action, pending] = useActionState(downloadLinkAction, IDLE);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="button button--outline button--small" disabled={pending}>
        Скачать
      </button>
      {state.status === 'link' ? (
        <p role="status">
          {/* Ссылка одноразовая и действует 5 минут; после перехода погашается. */}
          <a href={state.path} download>
            Скачать файл (ссылка одноразовая, 5 минут)
          </a>
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p className="adm-flash adm-flash--error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function RestoreForm({ id, name }: { id: number; name: string }) {
  return (
    <form action={requestRestoreAction} aria-label={`Восстановить из ${name}`}>
      <input type="hidden" name="id" value={id} />
      <p className="ops-muted">
        Шаг 1 из 2. Прежние данные сохранятся: перед запросом автоматически создаётся копия «до восстановления». Замена данных произойдёт при следующем запуске приложения. Всё, что изменится в магазине после
        копии {name}, будет потеряно.
      </p>
      <div className="adm-field">
        <label htmlFor={`rs-w-${id}`}>Введите слово ВОССТАНОВИТЬ</label>
        <input id={`rs-w-${id}`} name="confirmWord" autoComplete="off" required />
      </div>
      <div className="adm-field">
        <label htmlFor={`rs-p-${id}`}>Ваш пароль</label>
        <input id={`rs-p-${id}`} name="password" type="password" autoComplete="current-password" required />
      </div>
      <button type="submit" className="button button--outline">
        Запросить восстановление
      </button>
    </form>
  );
}
