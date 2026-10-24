'use client';

import { useActionState } from 'react';
import { forgotPasswordAction, type ForgotState } from '../actions';

const IDLE: ForgotState = { status: 'idle' };

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, IDLE);
  if (state.status === 'sent') {
    return (
      <p role="status">
        Если такой сотрудник есть и у него указан email, мы отправили ссылку для установки нового пароля. Если логин не email, попросите администратора выдать ссылку.
      </p>
    );
  }
  return (
    <form action={action} className="admin-form" noValidate>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
      <div className="admin-field">
        <label htmlFor="forgot-login">Логин или email</label>
        <input id="forgot-login" name="login" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      </div>
      <div className="admin-trap" aria-hidden="true">
        <label>
          Сайт
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        {pending ? 'Подождите…' : 'Отправить ссылку'}
      </button>
    </form>
  );
}
