import { createHash, randomBytes } from 'node:crypto';
import { isProductionEnv } from '@/server/config';
import { getDb, type Db } from '@/server/db/connection';
import { sessionsRepo } from '@/server/db/repositories/sessions';
import { usersRepo } from '@/server/db/repositories/users';
import { getOrCreateOwnerRef, getOwnerRef, type CookieReader, type CookieStore, type OwnerRef } from '@/server/http/owner';

export const USER_SESSION_COOKIE = 'rts_session';
export const USER_SESSION_TTL_SEC = 60 * 60 * 24 * 30;

export type Opts = { db?: Db; now?: number };
export type UserSession = { userId: number; email: string };

/** Случайный токен 256 бит; клиенту уходит он, в БД — только hashToken(token). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 достаточно: токен случайный и длинный, перебор невозможен. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Параметры cookie сессии. Secure — в production (NODE_ENV или APP_ENV, как в config). */
export function sessionCookieOptions(maxAgeSec: number, sameSite: 'lax' | 'strict' = 'lax', env: Record<string, string | undefined> = process.env) {
  return {
    httpOnly: true,
    sameSite,
    secure: isProductionEnv(env),
    path: '/',
    maxAge: maxAgeSec,
  } as const;
}

export function createUserSession(cookies: CookieStore, userId: number, opts: Opts = {}): void {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const token = generateToken();
  sessionsRepo.deleteExpired(db, 'user', now);
  sessionsRepo.insert(db, 'user', {
    ownerId: userId,
    tokenHash: hashToken(token),
    now,
    expiresAt: now + USER_SESSION_TTL_SEC * 1000,
  });
  cookies.set(USER_SESSION_COOKIE, token, sessionCookieOptions(USER_SESSION_TTL_SEC));
}

/** Пользователь по cookie rts_session или null. Сессию сотрудника (другая cookie и таблица) не принимает. */
export function getSession(cookies: CookieReader, opts: Opts = {}): UserSession | null {
  const token = cookies.get(USER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = opts.db ?? getDb();
  const userId = sessionsRepo.findOwnerId(db, 'user', hashToken(token), opts.now ?? Date.now());
  if (userId === null) return null;
  const user = usersRepo.findById(db, userId);
  return user ? { userId: user.id, email: user.email } : null;
}

export function destroyUserSession(cookies: CookieStore, opts: Opts = {}): void {
  const token = cookies.get(USER_SESSION_COOKIE)?.value;
  if (token) sessionsRepo.deleteByHash(opts.db ?? getDb(), 'user', hashToken(token));
  cookies.set(USER_SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
}

/** Владелец данных: вошедший пользователь, иначе гость по cookie, иначе null. */
export function resolveOwner(cookies: CookieReader, opts: Opts = {}): OwnerRef | null {
  const session = getSession(cookies, opts);
  if (session) return { kind: 'user', userId: session.userId };
  return getOwnerRef(cookies);
}

/** Как resolveOwner, но без сессии и cookie создаёт гостя (только где cookies можно менять). */
export function resolveOrCreateOwner(cookies: CookieStore, opts: Opts = {}): OwnerRef {
  const session = getSession(cookies, opts);
  if (session) return { kind: 'user', userId: session.userId };
  return getOrCreateOwnerRef(cookies);
}
