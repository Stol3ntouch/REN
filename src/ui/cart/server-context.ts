import { cookies, headers } from 'next/headers';
import { resolveOrCreateOwner } from '@/domain/customers/session';
import { AppError, RateLimitError, ValidationError } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';
import type { CookieStore, OwnerRef } from '@/server/http/owner';
import { clientIp, enforceRateLimitByIp } from '@/server/http/rate-limit';
import type { CartFormState } from './state';

/**
 * Подготовка server action корзины/оформления: Origin (CSRF), лимит по IP, владелец
 * (гостю ставится httpOnly cookie rts_guest). Владелец берётся только из cookies, не из формы.
 */
export async function prepareCartAction(scope: string, limit = 120): Promise<{ owner: OwnerRef; ip: string }> {
  const h = await headers();
  assertOrigin({ method: 'POST', headers: h });
  const ip = clientIp(h);
  enforceRateLimitByIp(`form:${scope}`, ip, limit, 600);
  const owner = resolveOrCreateOwner((await cookies()) as unknown as CookieStore);
  return { owner, ip };
}

export function formInt(form: FormData, name: string): number {
  const v = form.get(name);
  return typeof v === 'string' && /^-?\d{1,9}$/.test(v.trim()) ? Number(v) : Number.NaN;
}

export function formStr(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

export function isHoneypotTripped(form: FormData): boolean {
  return formStr(form, 'website').trim() !== '';
}

/** Любую ошибку — в состояние формы без внутренних деталей. */
export function cartErrorState(e: unknown): CartFormState {
  if (e instanceof ValidationError) return { status: 'error', message: e.message, fields: e.fields };
  if (e instanceof RateLimitError) {
    return { status: 'error', message: `${e.message}. Повторите примерно через ${Math.max(1, Math.ceil(e.retryAfterSec / 60))} мин.` };
  }
  if (e instanceof AppError) return { status: 'error', message: e.message };
  return { status: 'error', message: 'Что-то пошло не так. Попробуйте ещё раз позже.' };
}
