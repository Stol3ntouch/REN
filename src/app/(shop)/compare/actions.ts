'use server';

import { revalidatePath } from 'next/cache';
import { compare } from '@/domain/customers/compare';
import { resolveOwner } from '@/domain/customers/session';
import { AppError } from '@/server/http/errors';
import { prepareAction, str } from '@/app/(shop)/account/(auth)/server-context';

/** «Убрать из сравнения» (работает и без JS). */
export async function removeCompareAction(form: FormData): Promise<void> {
  try {
    const ctx = await prepareAction('compare');
    const owner = resolveOwner(ctx.cookies);
    if (owner) compare.remove(owner, Number(str(form, 'productId')));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
  }
  revalidatePath('/compare');
}
