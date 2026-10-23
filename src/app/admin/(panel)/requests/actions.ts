'use server';

import { requestsAdmin } from '@/domain/requests/admin-ops';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';

/** Смена статуса и заметки по заявке. Право requests.write проверяет requestsAdmin.update. */
export async function updateRequestAction(form: FormData): Promise<never> {
  const back = field(form, 'back') === '/admin/questions' ? '/admin/questions' : '/admin/requests';
  return runAction(back, async (session) => {
    const id = Number(field(form, 'id'));
    if (!Number.isInteger(id) || id < 1) throw new ValidationError('Заявка не найдена');
    requestsAdmin.update(session, id, { status: field(form, 'status') || undefined, note: form.has('note') ? field(form, 'note') : undefined });
  });
}
