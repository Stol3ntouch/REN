import type { Db } from '@/server/db/connection';
import { sessionsRepo, type SessionKind } from '@/server/db/repositories/sessions';
import { RateLimitError } from '@/server/http/errors';

/** Блокировка перебора пароля: 5 неудач за 15 минут на пару email+IP (покупатели и сотрудники — отдельные счётчики). */
export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

const keyOf = (email: string, ip: string) => `${email}|${ip}`;

/** Бросает RateLimitError, если для пары уже набралось 5 неудач в окне. Время — параметром (тесты). */
export function assertNotLocked(db: Db, scope: SessionKind, email: string, ip: string, now: number): void {
  const { count, oldest } = sessionsRepo.failuresSince(db, scope, keyOf(email, ip), now - LOGIN_FAILURE_WINDOW_MS);
  if (count >= MAX_LOGIN_FAILURES && oldest !== null) {
    const retryAfterSec = Math.max(1, Math.ceil((oldest + LOGIN_FAILURE_WINDOW_MS - now) / 1000));
    throw new RateLimitError(retryAfterSec, 'Слишком много неудачных попыток входа. Попробуйте позже');
  }
}

export function recordFailure(db: Db, scope: SessionKind, email: string, ip: string, now: number): void {
  sessionsRepo.purgeFailures(db, now - LOGIN_FAILURE_WINDOW_MS);
  sessionsRepo.addFailure(db, scope, keyOf(email, ip), now);
}

export function clearFailures(db: Db, scope: SessionKind, email: string, ip: string): void {
  sessionsRepo.clearFailures(db, scope, keyOf(email, ip));
}
