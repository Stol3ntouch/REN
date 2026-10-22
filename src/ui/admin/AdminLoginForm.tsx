'use client';

import { useActionState } from 'react';
import { ErrorState } from '@/ui/states';
import { ADMIN_IDLE, type AdminFormState } from './form-state';

export function AdminLoginForm({ action }: { action: (prev: AdminFormState, form: FormData) => Promise<AdminFormState> }) {
  const [state, formAction, pending] = useActionState(action, ADMIN_IDLE);
  return (
    <form action={formAction} className="admin-form" noValidate>
      {state.status === 'error' && state.message ? (
        <ErrorState title="Войти не удалось">
          <p>{state.message}</p>
        </ErrorState>
      ) : null}
      <div className="admin-field">
        <label htmlFor="admin-email">Email</label>
        <input id="admin-email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="admin-field">
        <label htmlFor="admin-password">Пароль</label>
        <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className="admin-trap" aria-hidden="true">
        <label>
          Сайт
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        {pending ? 'Подождите…' : 'Войти'}
      </button>
    </form>
  );
}
