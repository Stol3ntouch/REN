import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { audit } from '@/domain/admin/audit';
import { requestInfoFromHeaders, runWithRequestInfo } from '@/domain/admin/audit-context';
import type { StaffSession } from '@/domain/admin/permissions';
import { requireStaff } from '@/domain/admin/staff-session';
import { AppError, ForbiddenError, UnauthorizedError } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';

/** Читает строковое поле формы (обрезает пробелы). */
export const field = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/**
 * Общая оболочка server action админки: Origin → сессия сотрудника → операция (она сама вызывает requirePermission) →
 * редирект назад с ok=1 либо error=<текст>. Неожиданные ошибки не раскрываются.
 */
export async function runAction(back: string, op: (session: StaffSession) => Promise<void> | void): Promise<never> {
  let failure: string | null = null;
  try {
    const h = await headers();
    assertOrigin({ method: 'POST', headers: h });
    const session = requireStaff(await cookies());
    const info = requestInfoFromHeaders(h);
    try {
      await runWithRequestInfo(info, async () => op(session));
    } catch (e) {
      // Отказ по правам попадает в журнал (result = denied) с хешем IP/UA.
      if (e instanceof ForbiddenError) {
        try {
          audit.record({ actorId: session.staffId, actorType: 'staff', action: 'access.denied', entity: 'admin_action', entityId: back.split('?')[0] ?? null, result: 'denied', request: info });
        } catch {
          // сбой журнала не должен подменять ответ об отказе
        }
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/admin/login');
    if (e instanceof AppError) failure = e.message;
    else throw e;
  }
  revalidatePath(back);
  const sep = back.includes('?') ? '&' : '?';
  redirect(failure === null ? `${back}${sep}ok=1` : `${back}${sep}error=${encodeURIComponent(failure)}`);
}

/** Результат действия, которое отвечает состоянием формы (useActionState), а не редиректом. */
export type StateResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Как runAction (Origin → сессия сотрудника → операция, отказы по правам в журнал), но без редиректа:
 * возвращает результат форме. Нужна там, где ответ содержит одноразовые данные (ссылка), которые нельзя класть в адрес.
 */
export async function runStateAction<T>(op: (session: StaffSession) => Promise<T> | T): Promise<StateResult<T>> {
  try {
    const h = await headers();
    assertOrigin({ method: 'POST', headers: h });
    const session = requireStaff(await cookies());
    const info = requestInfoFromHeaders(h);
    try {
      return { ok: true, data: await runWithRequestInfo(info, async () => op(session)) };
    } catch (e) {
      if (e instanceof ForbiddenError) {
        try {
          audit.record({ actorId: session.staffId, actorType: 'staff', action: 'access.denied', entity: 'admin_action', result: 'denied', request: info });
        } catch {
          // сбой журнала не должен подменять ответ об отказе
        }
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/admin/login');
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
