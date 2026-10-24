import { ForbiddenError, toErrorResponse } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';
import type { CookieReader } from '@/server/http/owner';
import { audit } from './audit';
import { requestInfoFromHeaders, runWithRequestInfo } from './audit-context';
import { hasPermission, requirePermission, type Permission, type StaffSession } from './permissions';
import { getStaffSession, requireStaff, type Opts } from './staff-session';

export const ADMIN_LOGIN_HREF = '/admin/login';

export type AdminAccess =
  | { ok: true; session: StaffSession }
  | { ok: false; reason: 'unauthenticated'; redirectTo: string }
  | { ok: false; reason: 'forbidden' };

/**
 * Решение для СТРАНИЦЫ админки: нет сессии сотрудника → редирект на /admin/login;
 * нет нужного права → forbidden (страница показывает 403). Чистая функция — тестируется без Next.
 */
export function resolveAdminAccess(cookies: CookieReader, perm: Permission | null = null, opts: Opts = {}): AdminAccess {
  const session = getStaffSession(cookies, opts);
  if (!session) return { ok: false, reason: 'unauthenticated', redirectTo: ADMIN_LOGIN_HREF };
  if (perm && !hasPermission(session, perm)) return { ok: false, reason: 'forbidden' };
  return { ok: true, session };
}

/** Cookie из заголовка Cookie запроса (для route handlers). */
export function parseCookieHeader(header: string | null): CookieReader {
  const jar = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      /* оставляем как есть */
    }
    if (!jar.has(name)) jar.set(name, value);
  }
  return { get: (name) => (jar.has(name) ? { value: jar.get(name)! } : undefined) };
}

export type StaffHandler = (req: Request, session: StaffSession) => Response | Promise<Response>;

/**
 * Обёртка для защищённого route handler: Origin для небезопасных методов → сессия сотрудника (401) →
 * право (403) → ваш обработчик. Ошибки превращаются в JSON через toErrorResponse.
 *   export const POST = withStaffPermission('catalog.write', async (req, session) => { ... });
 * Внутри обработчика по-прежнему можно вызвать requirePermission для более тонких проверок.
 */
export function withStaffPermission(perm: Permission, handler: StaffHandler, opts: Opts = {}): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      assertOrigin(req);
      const info = requestInfoFromHeaders(req.headers);
      const session = requireStaff(parseCookieHeader(req.headers.get('cookie')), opts);
      try {
        requirePermission(session, perm);
      } catch (e) {
        if (e instanceof ForbiddenError) recordDenied(session, perm, req, info, opts);
        throw e;
      }
      return await runWithRequestInfo(info, () => handler(req, session));
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

/** Отказ по правам попадает в журнал (result = denied): кто, чего хотел и по какому адресу. */
function recordDenied(session: StaffSession, perm: Permission, req: Request, info: ReturnType<typeof requestInfoFromHeaders>, opts: Opts): void {
  let path = '';
  try {
    path = new URL(req.url).pathname;
  } catch {
    path = '';
  }
  try {
    audit.record(
      { actorId: session.staffId, actorType: 'staff', action: 'access.denied', entity: 'admin_route', entityId: path || null, after: { permission: perm, method: req.method }, result: 'denied', request: info },
      { db: opts.db, now: opts.now },
    );
  } catch {
    // журнал недоступен — отказ всё равно возвращается клиенту
  }
}
