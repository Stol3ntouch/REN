import { z } from 'zod';
import { assertNotLocked, clearFailures, recordFailure } from '@/domain/customers/auth-throttle';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, dummyHash, hashPassword, verifyPassword } from '@/domain/customers/password';
import { getDb, withTransaction } from '@/server/db/connection';
import { staffRepo, type StaffRole } from '@/server/db/repositories/staff';
import { ConflictError, UnauthorizedError, ValidationError, type FieldErrors } from '@/server/http/errors';
import type { CookieStore } from '@/server/http/owner';
import { audit } from './audit';
import { createStaffSession, destroyStaffSession, type Opts } from './staff-session';

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
  password: z
    .string({ error: 'Введите пароль' })
    .min(MIN_PASSWORD_LENGTH, `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
    .max(MAX_PASSWORD_LENGTH),
  role: z.enum(['admin', 'manager'], { error: 'Роль: admin или manager' }),
  name: z.string().trim().max(100).optional(),
});

function toValidation(error: z.ZodError): ValidationError {
  const fields: FieldErrors = {};
  for (const i of error.issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  return new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}

/** Создаёт сотрудника и пишет 'staff.create' в аудит (без пароля). actor по умолчанию — система. */
export async function createStaff(
  input: unknown,
  opts: Opts & { actor?: { id: number | string; type: 'staff' | 'system' } } = {},
): Promise<{ staffId: number; role: StaffRole }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw toValidation(parsed.error);
  const data = parsed.data;
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const passwordHash = await hashPassword(data.password);

  const staffId = withTransaction(db, () => {
    if (staffRepo.findByEmail(db, data.email)) throw new ConflictError('Сотрудник с таким логином уже есть');
    const id = staffRepo.insert(db, { email: data.email, name: data.name, role: data.role, passwordHash, now });
    audit.record(
      {
        actorId: opts.actor?.id ?? null,
        actorType: opts.actor?.type ?? 'system',
        action: 'staff.create',
        entity: 'staff',
        entityId: id,
        after: { email: data.email, role: data.role, name: data.name ?? null },
      },
      { db, now },
    );
    return id;
  });
  return { staffId, role: data.role };
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

  assertNotLocked(db, 'staff', email, ctx.ip, now);

  const staff = staffRepo.findByEmail(db, email);
  const ok = await verifyPassword(password, staff ? staff.passwordHash : await dummyHash());
  if (!staff || !ok || !staff.active) {
    recordFailure(db, 'staff', email, ctx.ip, now);
    throw new UnauthorizedError(INVALID);
  }

  clearFailures(db, 'staff', email, ctx.ip);
  staffRepo.touchLogin(db, staff.id, now);
  destroyStaffSession(ctx.cookies, { db });
  createStaffSession(ctx.cookies, staff.id, { db, now });
  return { staffId: staff.id };
}

export function logoutStaff(cookies: CookieStore, opts: Opts = {}): void {
  destroyStaffSession(cookies, opts);
}
