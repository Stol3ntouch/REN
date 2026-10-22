'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/domain/admin/staff-session';
import type { StaffSession } from '@/domain/admin/permissions';
import { orderOps } from '@/domain/ordering/admin-ops';
import { isOrderStatus } from '@/domain/ordering/status';
import { AppError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
};
const int = (form: FormData, name: string): number => {
  const v = text(form, name);
  return /^\d{1,9}$/.test(v) ? Number(v) : Number.NaN;
};

/**
 * Общая оболочка server action карточки заказа: Origin → сессия сотрудника → операция (она сама проверяет право
 * через requirePermission) → возврат на карточку с сообщением. Ошибки прав и бизнес-правил показываются текстом.
 */
async function run(form: FormData, op: (session: StaffSession, orderId: number) => Promise<void> | void): Promise<never> {
  const number = text(form, 'number');
  const back = `/admin/orders/${encodeURIComponent(number)}`;
  try {
    assertOrigin({ method: 'POST', headers: await headers() });
    const session = requireStaff(await cookies());
    const orderId = int(form, 'orderId');
    if (!Number.isInteger(orderId)) throw new ValidationError('Заказ не указан');
    await op(session, orderId);
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/admin/login');
    if (e instanceof AppError) redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(back);
  revalidatePath('/admin/orders');
  redirect(`${back}?ok=1`);
}

export async function changeStatusAction(form: FormData): Promise<void> {
  await run(form, async (session, orderId) => {
    const to = text(form, 'status');
    if (!isOrderStatus(to)) throw new ValidationError('Выберите статус');
    await orderOps.changeStatus(session, orderId, to, text(form, 'note') || undefined);
  });
}

export async function cancelOrderAction(form: FormData): Promise<void> {
  await run(form, async (session, orderId) => {
    await orderOps.cancel(session, orderId, text(form, 'note') || undefined);
  });
}

export async function refundOrderAction(form: FormData): Promise<void> {
  await run(form, async (session, orderId) => {
    await orderOps.refund(session, orderId, text(form, 'note') || undefined);
  });
}

export async function assignOrderAction(form: FormData): Promise<void> {
  await run(form, (session, orderId) => {
    const raw = text(form, 'staffId');
    orderOps.assign(session, orderId, raw === '' ? null : int(form, 'staffId'));
  });
}

export async function addNoteAction(form: FormData): Promise<void> {
  await run(form, (session, orderId) => {
    orderOps.addNote(session, orderId, text(form, 'note'));
  });
}
