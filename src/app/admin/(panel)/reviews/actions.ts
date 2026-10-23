'use server';

import { reviewsAdmin } from '@/domain/requests/admin-ops';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';

/** Опубликовать или отклонить отзыв. Право reviews.moderate проверяет reviewsAdmin.moderate; действие пишется в аудит. */
export async function moderateReviewAction(form: FormData): Promise<never> {
  return runAction('/admin/reviews', async (session) => {
    const id = Number(field(form, 'id'));
    if (!Number.isInteger(id) || id < 1) throw new ValidationError('Отзыв не найден');
    reviewsAdmin.moderate(session, id, field(form, 'decision'));
  });
}
