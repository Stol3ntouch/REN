'use server';

import { redirect } from 'next/navigation';
import { login, logout, register, requestPasswordReset, resetPassword, safeRedirectPath } from '@/domain/customers/auth';
import type { FormState } from './form-state';
import { errorState, isHoneypotTripped, prepareAction, str } from './server-context';

const SENT: FormState = {
  status: 'success',
  message: 'Если такой адрес зарегистрирован, мы отправили на него письмо со ссылкой для сброса пароля. Ссылка действует 1 час.',
};

export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await prepareAction('register');
    if (isHoneypotTripped(form)) return { status: 'success', message: 'Готово.' };
    await register({ email: str(form, 'email'), password: str(form, 'password'), consent: form.get('consent') === 'on' }, ctx);
  } catch (e) {
    return errorState(e);
  }
  redirect(safeRedirectPath(str(form, 'next')));
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await prepareAction('login');
    if (isHoneypotTripped(form)) return { status: 'error', message: 'Неверный email или пароль' };
    await login({ email: str(form, 'email'), password: str(form, 'password') }, ctx);
  } catch (e) {
    return errorState(e);
  }
  redirect(safeRedirectPath(str(form, 'next')));
}

export async function forgotAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await prepareAction('forgot');
    if (isHoneypotTripped(form)) return SENT;
    await requestPasswordReset({ email: str(form, 'email') }, { ip: ctx.ip });
    return SENT;
  } catch (e) {
    return errorState(e);
  }
}

export async function resetAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    await prepareAction('reset');
    if (isHoneypotTripped(form)) return { status: 'success', message: 'Готово.' };
    await resetPassword({ token: str(form, 'token'), password: str(form, 'password') });
  } catch (e) {
    return errorState(e);
  }
  redirect('/account/login?reset=1');
}

export async function logoutAction(): Promise<void> {
  const ctx = await prepareAction('logout');
  logout(ctx.cookies);
  redirect('/');
}
