'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginStaff, logoutStaff } from '@/domain/admin/staff';
import { AppError, RateLimitError } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';
import type { CookieStore } from '@/server/http/owner';
import { clientIp, enforceRateLimit } from '@/server/http/rate-limit';
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
    enforceRateLimit(`form:admin-login:${ip}`, 30, 600);
    const trap = form.get('website');
    if (typeof trap === 'string' && trap.trim() !== '') return { status: 'error', message: 'Неверный email или пароль' };
    const email = form.get('email');
    const password = form.get('password');
    await loginStaff(
      { email: typeof email === 'string' ? email : '', password: typeof password === 'string' ? password : '' },
      { cookies: (await cookies()) as unknown as CookieStore, ip },
    );
  } catch (e) {
    return toState(e);
  }
  redirect('/admin');
}

export async function adminLogoutAction(): Promise<void> {
  const h = await headers();
  assertOrigin({ method: 'POST', headers: h });
  logoutStaff((await cookies()) as unknown as CookieStore);
  redirect('/admin/login');
}
