import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from '@/domain/customers/password';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { staffRepo } from '@/server/db/repositories/staff';
import { staffSelfRepo } from '@/server/db/repositories/staff-self';
import { NotFoundError, UnauthorizedError, ValidationError, type FieldErrors } from '@/server/http/errors';
import { enforceRateLimit } from '@/server/http/rate-limit';

type Opts = { db?: Db; now?: number };

/** Профиль доступен любому авторизованному сотруднику (право «staff.self»): нужна только сессия. */
function requireSelf(session: StaffSession | null | undefined): asserts session is StaffSession {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
}

function toValidation(error: z.ZodError): ValidationError {
  const fields: FieldErrors = {};
  for (const i of error.issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  return new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}

const nameSchema = z.object({ name: z.string({ error: 'Введите имя' }).trim().max(100, 'Имя не длиннее 100 символов') });

const passwordSchema = z
  .object({
    current: z.string({ error: 'Введите текущий пароль' }).min(1, 'Введите текущий пароль').max(MAX_PASSWORD_LENGTH),
    next: z
      .string({ error: 'Введите новый пароль' })
      .min(MIN_PASSWORD_LENGTH, `Новый пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
      .max(MAX_PASSWORD_LENGTH, 'Пароль слишком длинный'),
    confirm: z.string({ error: 'Повторите новый пароль' }),
  })
  .refine((v) => v.next === v.confirm, { error: 'Пароли не совпадают', path: ['confirm'] })
  .refine((v) => v.next !== v.current, { error: 'Новый пароль должен отличаться от текущего', path: ['next'] });

export type ProfileView = { email: string; name: string | null; role: StaffSession['role']; lastLoginAt: number | null };

/** Профиль текущего сотрудника: имя и смена своего пароля. Логин и роль здесь не меняются. */
export const profileOps = {
  get(session: StaffSession | null, opts: Opts = {}): ProfileView {
    requireSelf(session);
    const row = staffRepo.findById(opts.db ?? getDb(), session.staffId);
    if (!row) throw new NotFoundError('Сотрудник не найден');
    return { email: row.email, name: row.name, role: row.role, lastLoginAt: row.lastLoginAt };
  },

  updateName(session: StaffSession | null, input: unknown, opts: Opts = {}): void {
    requireSelf(session);
    const parsed = nameSchema.safeParse(input);
    if (!parsed.success) throw toValidation(parsed.error);
    const db = opts.db ?? getDb();
    const name = parsed.data.name === '' ? null : parsed.data.name;
    withTransaction(db, () => {
      const before = staffRepo.findById(db, session.staffId);
      if (!before) throw new NotFoundError('Сотрудник не найден');
      if (before.name === name) return;
      staffSelfRepo.setName(db, session.staffId, name);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'staff.profile_update', entity: 'staff', entityId: session.staffId, before: { name: before.name }, after: { name } },
        { db, now: opts.now },
      );
    });
  },

  /**
   * Смена своего пароля: нужен текущий пароль, новый ≥10 символов. Все остальные сессии завершаются
   * (`keepTokenHash` — хеш токена текущей сессии, она остаётся). Не больше 10 попыток за 15 минут.
   */
  async changePassword(session: StaffSession | null, input: unknown, ctx: Opts & { keepTokenHash: string | null }): Promise<{ closedSessions: number }> {
    requireSelf(session);
    const db = ctx.db ?? getDb();
    enforceRateLimit(`admin-self-password:${session.staffId}`, 10, 900, { db, now: ctx.now });
    const parsed = passwordSchema.safeParse(input);
    if (!parsed.success) throw toValidation(parsed.error);
    const row = staffRepo.findById(db, session.staffId);
    if (!row || !row.active) throw new UnauthorizedError('Требуется вход в админку');
    if (!(await verifyPassword(parsed.data.current, row.passwordHash))) {
      throw new ValidationError('Текущий пароль указан неверно', { current: ['Текущий пароль указан неверно'] });
    }
    const hash = await hashPassword(parsed.data.next);
    return withTransaction(db, () => {
      staffSelfRepo.setPasswordHash(db, session.staffId, hash);
      const closedSessions = staffSelfRepo.deleteOtherSessions(db, session.staffId, ctx.keepTokenHash);
      // Пароль в журнал не попадает — только факт смены.
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'staff.password_change', entity: 'staff', entityId: session.staffId, after: { closedSessions } },
        { db, now: ctx.now },
      );
      return { closedSessions };
    });
  },
};
