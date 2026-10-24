'use client';

import { useActionState } from 'react';
import { ADMIN_IDLE } from '@/ui/admin/form-state';
import { setPasswordByLinkAction } from '../../actions';

export function SetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(setPasswordByLinkAction, ADMIN_IDLE);
  return (
    <form action={action} className="admin-form" noValidate>
      {state.status === 'error' && state.message ? <p role="alert">{state.message}</p> : null}
      <input type="hidden" name="token" value={token} />
      <div className="admin-field">
        <label htmlFor="new-password">Новый пароль (не короче 10 символов)</label>
        <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      <div className="admin-field">
        <label htmlFor="new-password2">Повторите пароль</label>
        <input id="new-password2" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        {pending ? 'Подождите…' : 'Сохранить пароль'}
      </button>
    </form>
  );
}
