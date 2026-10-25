'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/domain/admin/staff-session';
import type { StaffSession } from '@/domain/admin/permissions';
import { orderOps } from '@/domain/ordering/admin-ops';
import type { ItemsLine } from '@/domain/ordering/order-edit';
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

/** Возврат на предыдущий шаг: причина обязательна. */
export async function revertStatusAction(form: FormData): Promise<void> {
  await run(form, async (session, orderId) => {
    const to = text(form, 'status');
    if (!isOrderStatus(to)) throw new ValidationError('Выберите статус, на который вернуть заказ');
    await orderOps.revert(session, orderId, to, text(form, 'note') || undefined);
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

/** «Отметить оплаченным»: нужен флажок подтверждения и комментарий. */
export async function markPaidAction(form: FormData): Promise<void> {
  await run(form, async (session, orderId) => {
    await orderOps.markPaid(session, orderId, { comment: text(form, 'comment'), confirm: form.get('confirm') === 'on' });
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
    orderOps.addComment(session, orderId, text(form, 'note'));
  });
}

export async function updateDetailsAction(form: FormData): Promise<void> {
  await run(form, async (session, orderId) => {
    await orderOps.updateDetails(session, orderId, {
      name: text(form, 'name'),
      phone: text(form, 'phone'),
      email: text(form, 'email'),
      address: text(form, 'address'),
      comment: text(form, 'comment'),
    });
  });
}

/** «Изменить состав»: строки qty_<id> существующих позиций (0 — убрать) и одна новая позиция по id товара. */
export async function editItemsAction(form: FormData): Promise<void> {
  await run(form, async (session, orderId) => {
    const lines: ItemsLine[] = [];
    for (const [key, value] of form.entries()) {
      const m = /^qty_(\d{1,9})$/.exec(key);
      if (m && typeof value === 'string') lines.push({ itemId: Number(m[1]), qty: Number(value) });
    }
    const addId = text(form, 'addProductId');
    if (addId !== '') lines.push({ productId: Number(addId), qty: Number(text(form, 'addQty') || '1') });
    if (lines.some((l) => !Number.isInteger(l.qty))) throw new ValidationError('Количество — целое число');
    await orderOps.editItems(session, orderId, { lines, reason: text(form, 'reason') });
  });
}
