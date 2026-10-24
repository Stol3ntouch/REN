'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requestInfoFromHeaders, runWithRequestInfo } from '@/domain/admin/audit-context';
import { loginStaff, logoutStaff } from '@/domain/admin/staff';
import { completeStaffLink, requestStaffPasswordReset } from '@/domain/admin/staff-reset';
import { AppError, RateLimitError } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';
import type { CookieStore } from '@/server/http/owner';
import { clientIp, enforceRateLimitByIp } from '@/server/http/rate-limit';
import type { AdminFormState } from '@/ui/admin/form-state';

function toState(e: unknown): AdminFormState {
  if (e instanceof RateLimitError) {
    return { status: 'error', message: `${e.message}. Повторите примерно через ${Math.max(1, Math.ceil(e.retryAfterSec / 60))} мин.` };
  }
  if (e instanceof AppError) return { status: 'error', message: e.message };
  return { status: 'error', message: 'Что-то пошло не так. Попробуйте ещё раз позже.' };
}

export async function adminLoginAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  try {
    const h = await headers();
    assertOrigin({ method: 'POST', headers: h });
    const ip = clientIp(h);
    enforceRateLimitByIp('form:admin-login', ip, 30, 600);
    const trap = form.get('website');
    if (typeof trap === 'string' && trap.trim() !== '') return { status: 'error', message: 'Неверный логин или пароль' };
    const email = form.get('email');
    const password = form.get('password');
    const jar = (await cookies()) as unknown as CookieStore;
    await runWithRequestInfo(requestInfoFromHeaders(h), () =>
      loginStaff({ email: typeof email === 'string' ? email : '', password: typeof password === 'string' ? password : '' }, { cookies: jar, ip }),
    );
  } catch (e) {
    return toState(e);
  }
  redirect('/admin');
}

export async function adminLogoutAction(): Promise<void> {
  const h = await headers();
  assertOrigin({ method: 'POST', headers: h });
  const jar = (await cookies()) as unknown as CookieStore;
  runWithRequestInfo(requestInfoFromHeaders(h), () => logoutStaff(jar));
  redirect('/admin/login');
}

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

export type ForgotState = { status: 'idle' | 'sent' | 'error'; message?: string };

/** «Забыли пароль»: ответ всегда один и тот же, существование логина не раскрывается. */
export async function forgotPasswordAction(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  try {
    const h = await headers();
    assertOrigin({ method: 'POST', headers: h });
    if (text(form, 'website').trim() !== '') return { status: 'sent' };
    await requestStaffPasswordReset({ login: text(form, 'login') }, { ip: clientIp(h) });
    return { status: 'sent' };
  } catch (e) {
    if (e instanceof RateLimitError) return { status: 'error', message: 'Слишком много запросов. Повторите позже.' };
    return { status: 'error', message: 'Что-то пошло не так. Попробуйте ещё раз позже.' };
  }
}

/** Установка пароля по одноразовой ссылке (сброс или приглашение). Токен приходит скрытым полем формы. */
export async function setPasswordByLinkAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  try {
    const h = await headers();
    assertOrigin({ method: 'POST', headers: h });
    await runWithRequestInfo(requestInfoFromHeaders(h), () =>
      completeStaffLink({ token: text(form, 'token'), password: text(form, 'password'), confirm: text(form, 'confirm') }, { ip: clientIp(h) }),
    );
  } catch (e) {
    return toState(e);
  }
  redirect('/admin/login?reset=1');
}
