'use server';

import { revalidatePath } from 'next/cache';
import { accountOrders } from '@/domain/customers/account';
import { addresses } from '@/domain/customers/addresses';
import { profile } from '@/domain/customers/profile';
import { getSession } from '@/domain/customers/session';
import { AppError, UnauthorizedError } from '@/server/http/errors';
import type { FormState } from '../(auth)/form-state';
import { errorState, prepareAction, str } from '../(auth)/server-context';
import type { ReorderState } from './form-state';

/** Все действия кабинета: Origin и лимит (prepareAction), затем сессия — userId только из неё, не из формы. */
async function actionUser(scope: string): Promise<number> {
  const ctx = await prepareAction(`account:${scope}`);
  const session = getSession(ctx.cookies);
  if (!session) throw new UnauthorizedError('Войдите, чтобы продолжить');
  return session.userId;
}

export async function saveProfileAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const userId = await actionUser('profile');
    profile.update(userId, { name: str(form, 'name'), phone: str(form, 'phone') });
    revalidatePath('/account');
    return { status: 'success', message: 'Профиль сохранён.' };
  } catch (e) {
    return errorState(e);
  }
}

export async function addAddressAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const userId = await actionUser('address');
    addresses.add(userId, { label: str(form, 'label'), address: str(form, 'address') });
    revalidatePath('/account');
    return { status: 'success', message: 'Адрес добавлен.' };
  } catch (e) {
    return errorState(e);
  }
}

export async function removeAddressAction(form: FormData): Promise<void> {
  try {
    const userId = await actionUser('address');
    addresses.remove(userId, Number(str(form, 'id')));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
  }
  revalidatePath('/account');
}

export async function reorderAction(_prev: ReorderState, form: FormData): Promise<ReorderState> {
  try {
    const userId = await actionUser('reorder');
    const res = accountOrders.reorder(userId, str(form, 'number'));
    revalidatePath('/cart');
    if (res.added === 0) {
      return { status: 'error', message: 'Ни одну позицию добавить не удалось.', skipped: res.skipped };
    }
    return {
      status: 'success',
      message: `Добавлено в корзину позиций: ${res.added}. Цены взяты актуальные.`,
      skipped: res.skipped,
    };
  } catch (e) {
    return { status: 'error', message: errorState(e).message };
  }
}
