import { cookies, headers } from 'next/headers';
import { AppError, RateLimitError, ValidationError } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';
import type { CookieStore } from '@/server/http/owner';
import { clientIp, enforceRateLimit } from '@/server/http/rate-limit';
import type { FormState } from './form-state';

/**
 * Общая подготовка server action публичной формы: проверка Origin (CSRF), лимит по IP,
 * cookies и IP клиента. Honeypot проверяет сам action через isHoneypotTripped.
 */
export async function prepareAction(scope: string): Promise<{ cookies: CookieStore; ip: string }> {
  const h = await headers();
  assertOrigin({ method: 'POST', headers: h });
  const ip = clientIp(h);
  enforceRateLimit(`form:${scope}:${ip}`, 30, 600);
  return { cookies: (await cookies()) as unknown as CookieStore, ip };
}

/** Скрытое поле `website`: человек его не видит и не заполняет, бот — заполняет. */
export function isHoneypotTripped(form: FormData): boolean {
  const v = form.get('website');
  return typeof v === 'string' && v.trim() !== '';
}

export function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

/** Любую ошибку — в состояние формы без внутренних деталей. */
export function errorState(e: unknown): FormState {
  if (e instanceof ValidationError) return { status: 'error', message: e.message, fields: e.fields };
  if (e instanceof RateLimitError) {
    const min = Math.max(1, Math.ceil(e.retryAfterSec / 60));
    return { status: 'error', message: `${e.message}. Повторите примерно через ${min} мин.` };
  }
  if (e instanceof AppError) return { status: 'error', message: e.message };
  return { status: 'error', message: 'Что-то пошло не так. Попробуйте ещё раз позже.' };
}
