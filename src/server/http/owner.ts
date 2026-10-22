import { randomUUID } from 'node:crypto';
import { getConfig } from '../config';

/** Владелец корзины/избранного/сравнения: пользователь или гость. T03 подставляет user по сессии. */
export type OwnerRef = { kind: 'user'; userId: number } | { kind: 'guest'; guestId: string };

/** Минимум от cookies() из next/headers и от тестовых заглушек. */
export type CookieReader = { get(name: string): { value: string } | undefined };
export type CookieStore = CookieReader & { set(name: string, value: string, options?: Record<string, unknown>): unknown };

export const GUEST_COOKIE = 'rts_guest';
const GUEST_MAX_AGE_SEC = 60 * 60 * 24 * 180;
const GUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createGuestId(): string {
  return randomUUID();
}

function secureFlag(): boolean {
  try {
    return getConfig().cookieSecure;
  } catch {
    return process.env.NODE_ENV === 'production';
  }
}

/** Владелец по cookie гостя; нет cookie или она испорчена → null (читать можно, создавать нечего). */
export function getOwnerRef(cookies: CookieReader): OwnerRef | null {
  const value = cookies.get(GUEST_COOKIE)?.value;
  return value && GUEST_ID_RE.test(value) ? { kind: 'guest', guestId: value } : null;
}

/** Как getOwnerRef, но при отсутствии cookie создаёт гостя и ставит httpOnly cookie. Только там, где cookies можно менять (route handler, server action). */
export function getOrCreateOwnerRef(cookies: CookieStore): OwnerRef {
  const existing = getOwnerRef(cookies);
  if (existing) return existing;
  const guestId = createGuestId();
  cookies.set(GUEST_COOKIE, guestId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureFlag(),
    path: '/',
    maxAge: GUEST_MAX_AGE_SEC,
  });
  return { kind: 'guest', guestId };
}
