'use server';

import { ValidationError } from '@/server/http/errors';
import { customersOps } from '../_lib/customers-ops';
import { field, runAction } from '../_lib/run-action';

function idOf(form: FormData): number {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Клиент не найден');
  return id;
}
const back = (form: FormData) => `/admin/customers/${Number(field(form, 'id')) || ''}`;

/** Через runAction (Origin, сессия); право customers.write проверяет customersOps. */
export async function setCustomerStatusAction(form: FormData): Promise<never> {
  return runAction(back(form), (session) => {
    customersOps.setStatus(session, idOf(form), field(form, 'status'));
  });
}

export async function addCustomerNoteAction(form: FormData): Promise<never> {
  return runAction(back(form), (session) => {
    customersOps.addNote(session, idOf(form), field(form, 'body'));
  });
}
