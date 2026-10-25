'use server';

import { inquiriesOps } from '@/domain/requests/sales-admin';
import { isInquiryStatus } from '@/domain/requests/workflow';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';

const LIST = '/admin/inquiries';

function idOf(form: FormData): number {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Обращение не найдено');
  return id;
}

/** Каждое действие: Origin → сессия (runAction) → операция, которая сама проверяет право inquiries.write. */
export async function setInquiryStatusAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, (session) => {
    const to = field(form, 'status');
    if (!isInquiryStatus(to)) throw new ValidationError('Выберите статус');
    inquiriesOps.setStatus(session, idOf(form), to, field(form, 'note') || null);
  });
}

export async function assignInquiryAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, (session) => {
    const raw = field(form, 'staffId');
    inquiriesOps.assign(session, idOf(form), raw === '' ? null : Number(raw));
  });
}

export async function commentInquiryAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, (session) => {
    inquiriesOps.addComment(session, idOf(form), field(form, 'body'));
  });
}

/** Массово: назначить ответственного или закрыть. */
export async function bulkInquiriesAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    const ids = form.getAll('ids').map((v) => Number(v));
    const kind = field(form, 'bulk');
    if (kind === 'close') inquiriesOps.bulk(session, ids, { type: 'status', to: 'closed' });
    else if (kind === 'assign') {
      const raw = field(form, 'staffId');
      inquiriesOps.bulk(session, ids, { type: 'assign', staffId: raw === '' ? null : Number(raw) });
    } else throw new ValidationError('Выберите действие');
  });
}
