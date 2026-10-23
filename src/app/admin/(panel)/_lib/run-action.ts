import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { StaffSession } from '@/domain/admin/permissions';
import { requireStaff } from '@/domain/admin/staff-session';
import { AppError, UnauthorizedError } from '@/server/http/errors';
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
    assertOrigin({ method: 'POST', headers: await headers() });
    const session = requireStaff(await cookies());
    await op(session);
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/admin/login');
    if (e instanceof AppError) failure = e.message;
    else throw e;
  }
  revalidatePath(back);
  const sep = back.includes('?') ? '&' : '?';
  redirect(failure === null ? `${back}${sep}ok=1` : `${back}${sep}error=${encodeURIComponent(failure)}`);
}
