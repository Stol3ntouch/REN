'use server';

import { mailAdmin } from '@/integrations/mail/admin-ops';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';

/** Поставить упавшее письмо на повторную отправку (только admin; право проверяет mailAdmin.retry). */
export async function retryMailAction(form: FormData): Promise<never> {
  return runAction('/admin/mail', async (session) => {
    const id = Number(field(form, 'id'));
    if (!Number.isInteger(id) || id < 1) throw new ValidationError('Письмо не найдено');
    mailAdmin.retry(session, id);
  });
}
