'use server';

import { reviewsModeration } from '@/domain/content/reviews-admin';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';

const back = (form: FormData): string => {
  const raw = field(form, 'back');
  return raw.startsWith('/admin/reviews') && !raw.includes('//') ? raw.replace(/([?&])(ok|error)=[^&]*/g, '').replace(/[?&]$/, '') : '/admin/reviews';
};
const idOf = (form: FormData): number => {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Отзыв не найден');
  return id;
};

/** Решение по отзыву: опубликовать, отклонить, вернуть в ожидание. Право reviews.moderate проверяет reviewsModeration; аудит пишет она же. */
export async function moderateReviewAction(form: FormData): Promise<never> {
  return runAction(back(form), async (session) => {
    reviewsModeration.moderate(session, idOf(form), field(form, 'decision'));
  });
}

/** Ответ администратора под отзывом (пустой текст убирает ответ). */
export async function replyReviewAction(form: FormData): Promise<never> {
  return runAction(back(form), async (session) => {
    const raw = form.get('reply');
    reviewsModeration.reply(session, idOf(form), typeof raw === 'string' ? raw : '');
  });
}
