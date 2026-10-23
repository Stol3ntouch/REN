import { z } from 'zod';
import { enqueueMail } from '@/domain/admin/mail-enqueue';
import { getConfig } from '@/server/config';
import { getDb, withTransaction } from '@/server/db/connection';
import { sessionsRepo } from '@/server/db/repositories/sessions';
import { usersRepo } from '@/server/db/repositories/users';
import { ConflictError, UnauthorizedError, ValidationError, type FieldErrors } from '@/server/http/errors';
import { getOwnerRef, type CookieStore } from '@/server/http/owner';
import { enforceRateLimit, enforceRateLimitByIp } from '@/server/http/rate-limit';
import { assertNotLocked, clearFailures, recordFailure } from './auth-throttle';
import { consent } from './consent';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, dummyHash, hashPassword, verifyPassword } from './password';
import { createUserSession, destroyUserSession, generateToken, hashToken, type Opts } from './session';

export type AuthCtx = Opts & { cookies: CookieStore; ip: string };
/** Слияние гостевых данных (корзина, избранное, сравнение) при входе/регистрации: T05/T07 подключают свои хуки. */
export type OnLoginHook = (guestId: string | null, userId: number) => void | Promise<void>;

export const RESET_TTL_MS = 60 * 60 * 1000;

const hooks: OnLoginHook[] = [];
export function registerOnLoginHook(hook: OnLoginHook): void {
  hooks.push(hook);
}
export function clearOnLoginHooks(): void {
  hooks.length = 0;
}

const emailSchema = z
  .string({ error: 'Введите email' })
  .trim()
  .toLowerCase()
  .max(254, 'Слишком длинный email')
  .pipe(z.email({ error: 'Введите корректный email' }));
const passwordSchema = z
  .string({ error: 'Введите пароль' })
  .min(MIN_PASSWORD_LENGTH, `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
  .max(MAX_PASSWORD_LENGTH, 'Слишком длинный пароль');

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const res = schema.safeParse(input);
  if (res.success) return res.data;
  const fields: FieldErrors = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    (fields[key] ??= []).push(issue.message);
  }
  throw new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}

async function runLoginHooks(cookies: CookieStore, userId: number): Promise<void> {
  const owner = getOwnerRef(cookies);
  const guestId = owner?.kind === 'guest' ? owner.guestId : null;
  for (const hook of hooks) {
    try {
      await hook(guestId, userId);
    } catch (e) {
      // Сбой слияния не должен ронять вход; в лог — только тип ошибки (без данных).
      console.error('onLogin hook failed:', e instanceof Error ? e.name : 'unknown');
    }
  }
}

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  consent: z.literal(true, { error: 'Нужно согласие на обработку персональных данных' }),
});

export async function register(input: unknown, ctx: AuthCtx): Promise<{ userId: number }> {
  const data = parse(registerSchema, input);
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();
  const passwordHash = await hashPassword(data.password);

  const userId = withTransaction(db, () => {
    if (usersRepo.findByEmail(db, data.email)) throw new ConflictError('Этот email уже зарегистрирован. Войдите или восстановите пароль');
    const id = (() => {
      try {
        return usersRepo.insert(db, { email: data.email, passwordHash, now });
      } catch {
        throw new ConflictError('Этот email уже зарегистрирован. Войдите или восстановите пароль');
      }
    })();
    consent.record({ kind: 'privacy', source: 'register', userId: id }, { db, now });
    return id;
  });

  destroyUserSession(ctx.cookies, { db });
  createUserSession(ctx.cookies, userId, { db, now });
  await runLoginHooks(ctx.cookies, userId);
  return { userId };
}

const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Введите пароль' }).min(1, 'Введите пароль').max(MAX_PASSWORD_LENGTH),
});

export const INVALID_CREDENTIALS = 'Неверный email или пароль';

export async function login(input: unknown, ctx: AuthCtx): Promise<{ userId: number }> {
  const { email, password } = parse(loginSchema, input);
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();

  assertNotLocked(db, 'user', email, ctx.ip, now);

  const user = usersRepo.findByEmail(db, email);
  // Для неизвестного email проверяем пароль против заготовки: время ответа не выдаёт наличие аккаунта.
  const ok = await verifyPassword(password, user ? user.passwordHash : await dummyHash());
  if (!user || !ok) {
    recordFailure(db, 'user', email, ctx.ip, now);
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }

  clearFailures(db, 'user', email, ctx.ip);
  usersRepo.touchLogin(db, user.id, now);
  destroyUserSession(ctx.cookies, { db }); // новая сессия вместо старой (защита от фиксации)
  createUserSession(ctx.cookies, user.id, { db, now });
  await runLoginHooks(ctx.cookies, user.id);
  return { userId: user.id };
}

export function logout(cookies: CookieStore, opts: Opts = {}): void {
  destroyUserSession(cookies, opts);
}

/**
 * Запрос ссылки сброса. Ответ всегда `{ ok: true }` — не раскрывает, есть ли такой email.
 * Лимиты считаются по IP и по email независимо от существования аккаунта.
 */
export async function requestPasswordReset(input: unknown, ctx: Opts & { ip: string; siteUrl?: string }): Promise<{ ok: true }> {
  const { email } = parse(z.object({ email: emailSchema }), input);
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();

  enforceRateLimitByIp('reset:ip', ctx.ip, 10, 900, { db, now });
  enforceRateLimit(`reset:email:${email}`, 3, 3600, { db, now });

  const user = usersRepo.findByEmail(db, email);
  if (user) {
    const token = generateToken();
    withTransaction(db, () => {
      sessionsRepo.expireOpenResets(db, user.id, now);
      sessionsRepo.insertReset(db, { userId: user.id, tokenHash: hashToken(token), now, expiresAt: now + RESET_TTL_MS });
    });
    const base = (ctx.siteUrl ?? getConfig().siteUrl ?? '').replace(/\/+$/, '');
    enqueueMail('auth.password_reset', { to: user.email, resetUrl: `${base}/account/reset/${token}`, expiresAt: now + RESET_TTL_MS }, { db, now });
  }
  return { ok: true };
}

const resetSchema = z.object({ token: z.string().min(1).max(200), password: passwordSchema });
export const RESET_LINK_INVALID = 'Ссылка недействительна или устарела. Запросите новую';

/** Задаёт новый пароль по одноразовой ссылке (TTL 1 час) и закрывает все сессии пользователя. */
export async function resetPassword(input: unknown, ctx: Opts = {}): Promise<void> {
  const { token, password } = parse(resetSchema, input);
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();
  const passwordHash = await hashPassword(password);

  withTransaction(db, () => {
    const userId = sessionsRepo.consumeReset(db, hashToken(token), now);
    if (userId === null) throw new ValidationError(RESET_LINK_INVALID);
    usersRepo.setPasswordHash(db, userId, passwordHash);
    sessionsRepo.deleteAllForOwner(db, 'user', userId);
  });
}

/** Безопасный путь возврата после входа: только внутренний, иначе fallback. */
export function safeRedirectPath(next: unknown, fallback = '/account'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

