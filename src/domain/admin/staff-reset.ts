import { z } from 'zod';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword } from '@/domain/customers/password';
import { generateToken, hashToken } from '@/domain/customers/session';
import { getConfig } from '@/server/config';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { staffRepo } from '@/server/db/repositories/staff';
import { staffAdminRepo } from '@/server/db/repositories/staff-admin';
import { staffResetsRepo, type StaffLinkKind } from '@/server/db/repositories/staff-resets';
import { ValidationError } from '@/server/http/errors';
import { enforceRateLimit, enforceRateLimitByIp } from '@/server/http/rate-limit';
import { audit } from './audit';
import { enqueueMail } from './mail-enqueue';

type Opts = { db?: Db; now?: number };

export const RESET_TTL_MS = 60 * 60 * 1000;
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const STAFF_LINK_INVALID = 'Ссылка недействительна или устарела. Попросите новую';

export type IssuedLink = { token: string; expiresAt: number; kind: StaffLinkKind };

/** Выдаёт одноразовую ссылку (прежние неиспользованные гасятся). Токен возвращается один раз, в БД — хеш. */
export function issueStaffLink(db: Db, v: { staffId: number; kind: StaffLinkKind; createdBy: number | null; now: number; ttlMs: number }): IssuedLink {
  const token = generateToken();
  const expiresAt = v.now + v.ttlMs;
  staffResetsRepo.expireOpen(db, v.staffId, v.now);
  staffResetsRepo.insert(db, { staffId: v.staffId, tokenHash: hashToken(token), kind: v.kind, createdBy: v.createdBy, now: v.now, expiresAt });
  return { token, expiresAt, kind: v.kind };
}

/** Полный адрес страницы установки пароля. Без SITE_URL — относительный. */
export function staffLinkUrl(token: string, siteUrl?: string): string {
  let base = siteUrl;
  if (base === undefined) {
    try {
      base = getConfig().siteUrl ?? '';
    } catch {
      base = '';
    }
  }
  return `${base.replace(/\/+$/, '')}/admin/reset/${token}`;
}

/** Ссылка ещё действует? (страница установки пароля показывает форму или «ссылка устарела») */
export function peekStaffLink(token: string, opts: Opts = {}): { kind: StaffLinkKind } | null {
  if (!token || token.length > 200) return null;
  const hit = staffResetsRepo.peek(opts.db ?? getDb(), hashToken(token), opts.now ?? Date.now());
  return hit ? { kind: hit.kind } : null;
}

const completeSchema = z.object({
  token: z.string().min(1).max(200),
  password: z
    .string({ error: 'Введите пароль' })
    .min(MIN_PASSWORD_LENGTH, `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
    .max(MAX_PASSWORD_LENGTH, 'Пароль слишком длинный'),
  confirm: z.string().optional(),
});

/**
 * Устанавливает пароль по одноразовой ссылке (сброс или приглашение). Ссылка сгорает, все сессии сотрудника
 * закрываются. Заблокированному сотруднику ссылка не помогает. Пароль в журнал не попадает.
 */
export async function completeStaffLink(input: unknown, ctx: Opts & { ip?: string } = {}): Promise<{ staffId: number }> {
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Проверьте введённые данные');
  const { token, password, confirm } = parsed.data;
  if (confirm !== undefined && confirm !== password) throw new ValidationError('Пароли не совпадают', { confirm: ['Пароли не совпадают'] });
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();
  if (ctx.ip) enforceRateLimitByIp('staff-reset-complete', ctx.ip, 20, 900, { db, now });
  const hash = await hashPassword(password);

  return withTransaction(db, () => {
    const hit = staffResetsRepo.consume(db, hashToken(token), now);
    if (!hit) throw new ValidationError(STAFF_LINK_INVALID);
    const staff = staffRepo.findById(db, hit.staffId);
    if (!staff || !staff.active) throw new ValidationError(STAFF_LINK_INVALID);
    staffAdminRepo.setPasswordHash(db, staff.id, hash);
    const closed = Number(db.prepare('DELETE FROM staff_sessions WHERE staff_id = ?').run(staff.id).changes);
    audit.record(
      { actorId: staff.id, actorType: 'staff', action: hit.kind === 'invite' ? 'staff.invite_accept' : 'staff.password_reset', entity: 'staff', entityId: staff.id, after: { closedSessions: closed } },
      { db, now },
    );
    return { staffId: staff.id };
  });
}

/**
 * «Забыли пароль» на странице входа. Ответ всегда один и тот же — существование логина не раскрывается.
 * Письмо уходит только активному сотруднику, у которого логин — email; остальным ссылку выдаёт администратор.
 */
export async function requestStaffPasswordReset(input: unknown, ctx: Opts & { ip: string; siteUrl?: string }): Promise<{ ok: true }> {
  const parsed = z.object({ login: z.string().trim().toLowerCase().min(1).max(254) }).safeParse(input);
  if (!parsed.success) return { ok: true };
  const login = parsed.data.login;
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();
  enforceRateLimitByIp('staff-reset:ip', ctx.ip, 10, 900, { db, now });
  enforceRateLimit(`staff-reset:login:${login}`, 3, 3600, { db, now });

  const staff = staffRepo.findByEmail(db, login);
  if (staff && staff.active && z.email().safeParse(staff.email).success) {
    const link = withTransaction(db, () => {
      const issued = issueStaffLink(db, { staffId: staff.id, kind: 'reset', createdBy: null, now, ttlMs: RESET_TTL_MS });
      audit.record({ actorId: staff.id, actorType: 'staff', action: 'staff.password_reset_request', entity: 'staff', entityId: staff.id }, { db, now });
      return issued;
    });
    enqueueMail('auth.password_reset', { to: staff.email, resetUrl: staffLinkUrl(link.token, ctx.siteUrl), expiresAt: link.expiresAt }, { db, now });
  }
  return { ok: true };
}
