'use server';

import { revalidatePath } from 'next/cache';
import { favorites } from '@/domain/customers/favorites';
import { resolveOwner } from '@/domain/customers/session';
import { AppError } from '@/server/http/errors';
import { prepareAction, str } from '@/app/(shop)/account/(auth)/server-context';

/** «Убрать из избранного» (работает и без JS). Владелец — только из cookies сервера. */
export async function removeFavoriteAction(form: FormData): Promise<void> {
  try {
    const ctx = await prepareAction('favorites');
    const owner = resolveOwner(ctx.cookies);
    if (owner) favorites.remove(owner, Number(str(form, 'productId')));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
  }
  revalidatePath('/favorites');
}
