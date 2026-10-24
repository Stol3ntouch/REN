import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { assertNotLocked, clearFailures, recordFailure } from '@/domain/customers/auth-throttle';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, dummyHash, hashPassword, verifyPassword } from '@/domain/customers/password';
import { getDb, withTransaction } from '@/server/db/connection';
import { rolesRepo } from '@/server/db/repositories/roles';
import { staffRepo, type StaffRole } from '@/server/db/repositories/staff';
import { AppError, ConflictError, UnauthorizedError, ValidationError, type FieldErrors } from '@/server/http/errors';
import type { CookieStore } from '@/server/http/owner';
import { audit } from './audit';
import { maskEmail } from './mask';
import { issueStaffLink, INVITE_TTL_MS, type IssuedLink } from './staff-reset';
import { createStaffSession, destroyStaffSession, getStaffSession, type Opts } from './staff-session';

export type StaffCtx = Opts & { cookies: CookieStore; ip: string };

/** Логин сотрудника: короткое имя (латиница, цифры, . _ -), регистр не важен. */
export const STAFF_LOGIN_RE = /^[A-Za-z0-9._-]{3,32}$/;

/** Идентификатор сотрудника при создании: email или короткий логин; нормализуется к нижнему регистру. */
const loginIdSchema = z
  .string({ error: 'Введите логин или email' })
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => STAFF_LOGIN_RE.test(v) || z.email().safeParse(v).success, {
    error: 'Логин: 3–32 символа (латиница, цифры, . _ -) или корректный email',
  });

const createSchema = z.object({
  email: loginIdSchema,
  /** Без пароля сотрудник получает одноразовую ссылку-приглашение и задаёт пароль сам. */
  password: z
    .string({ error: 'Введите пароль' })
    .min(MIN_PASSWORD_LENGTH, `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
    .max(MAX_PASSWORD_LENGTH)
    .optional(),
  /** Код роли из таблицы roles. */
  role: z.string({ error: 'Выберите роль' }).trim().min(1, 'Выберите роль').max(64),
  name: z.string().trim().max(100).optional(),
});

function toValidation(error: z.ZodError): ValidationError {
  const fields: FieldErrors = {};
  for (const i of error.issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  return new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}

/**
 * Создаёт сотрудника и пишет 'staff.create' в аудит (без пароля). actor по умолчанию — система.
 * Пароль не указан → сотрудник создаётся с непригодным для входа паролем и получает одноразовую ссылку-приглашение
 * (invite: токен показывается один раз, в БД — хеш).
 */
export async function createStaff(
  input: unknown,
  opts: Opts & { actor?: { id: number | string; type: 'staff' | 'system' } } = {},
): Promise<{ staffId: number; role: StaffRole; invite?: IssuedLink }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw toValidation(parsed.error);
  const data = parsed.data;
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  // Без пароля хеш строится из случайной строки, которую никто не знает: войти по нему нельзя.
  const passwordHash = await hashPassword(data.password ?? `invite-${randomBytes(24).toString('base64url')}`);

  return withTransaction(db, () => {
    const role = rolesRepo.findByCode(db, data.role);
    if (!role) throw new ValidationError('Такой роли нет', { role: ['Такой роли нет'] });
    if (staffRepo.findByEmail(db, data.email)) throw new ConflictError('Сотрудник с таким логином уже есть');
    const staffId = staffRepo.insert(db, { email: data.email, name: data.name, role: role.code, passwordHash, now });
    const invite = data.password === undefined ? issueStaffLink(db, { staffId, kind: 'invite', createdBy: typeof opts.actor?.id === 'number' ? opts.actor.id : null, now, ttlMs: INVITE_TTL_MS }) : undefined;
    audit.record(
      {
        actorId: opts.actor?.id ?? null,
        actorType: opts.actor?.type ?? 'system',
        action: 'staff.create',
        entity: 'staff',
        entityId: staffId,
        after: { email: data.email, role: role.code, name: data.name ?? null, invite: invite !== undefined },
      },
      { db, now },
    );
    return { staffId, role: role.code, ...(invite ? { invite } : {}) };
  });
}

// Формат логина при входе не проверяем: любая неверная пара даёт одну ошибку (не раскрываем, есть ли такой логин).
const loginSchema = z.object({
  email: z.string({ error: 'Введите логин или email' }).trim().toLowerCase().min(1, 'Введите логин или email').max(254),
  password: z.string().min(1, 'Введите пароль').max(MAX_PASSWORD_LENGTH),
});
const INVALID = 'Неверный логин или пароль';

export async function loginStaff(input: unknown, ctx: StaffCtx): Promise<{ staffId: number }> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw toValidation(parsed.error);
  const { email, password } = parsed.data;
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();
  const login = email.includes('@') ? maskEmail(email) : `${email[0] ?? ''}***`;
  const deny = (action: string, staffId: number | null): void => {
    // Отказ входа в журнале: без пароля, логин замаскирован.
    audit.record({ actorId: null, actorType: 'system', action, entity: 'auth', entityId: staffId, after: { login }, result: 'denied' }, { db, now });
  };

  try {
    assertNotLocked(db, 'staff', email, ctx.ip, now);
  } catch (e) {
    if (e instanceof AppError) deny('auth.login_locked', null);
    throw e;
  }

  const staff = staffRepo.findByEmail(db, email);
  const ok = await verifyPassword(password, staff ? staff.passwordHash : await dummyHash());
  if (!staff || !ok || !staff.active) {
    recordFailure(db, 'staff', email, ctx.ip, now);
    deny('auth.login_failed', staff?.id ?? null);
    throw new UnauthorizedError(INVALID);
  }

  clearFailures(db, 'staff', email, ctx.ip);
  staffRepo.touchLogin(db, staff.id, now);
  destroyStaffSession(ctx.cookies, { db });
  createStaffSession(ctx.cookies, staff.id, { db, now });
  audit.record({ actorId: staff.id, actorType: 'staff', action: 'auth.login', entity: 'auth', entityId: staff.id }, { db, now });
  return { staffId: staff.id };
}

export function logoutStaff(cookies: CookieStore, opts: Opts = {}): void {
  const session = getStaffSession(cookies, opts);
  destroyStaffSession(cookies, opts);
  if (session) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'auth.logout', entity: 'auth', entityId: session.staffId }, { db: opts.db, now: opts.now });
}
