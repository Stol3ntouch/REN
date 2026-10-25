'use server';

import { repairsOps } from '@/domain/requests/sales-admin';
import { isRepairStatus } from '@/domain/requests/workflow';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';

const LIST = '/admin/repairs';

function idOf(form: FormData): number {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Заявка не найдена');
  return id;
}
const back = (form: FormData) => `${LIST}/${Number(field(form, 'id')) || ''}`;

/** Все действия идут через runAction (Origin, сессия) и операции repairsOps, которые сами проверяют repair.write. */
export async function setRepairStatusAction(form: FormData): Promise<never> {
  return runAction(back(form), (session) => {
    const to = field(form, 'status');
    if (!isRepairStatus(to)) throw new ValidationError('Выберите статус');
    repairsOps.setStatus(session, idOf(form), to, field(form, 'note') || null);
  });
}

export async function assignRepairAction(form: FormData): Promise<never> {
  return runAction(back(form), (session) => {
    const raw = field(form, 'staffId');
    repairsOps.assign(session, idOf(form), raw === '' ? null : Number(raw));
  });
}

export async function commentRepairAction(form: FormData): Promise<never> {
  return runAction(back(form), (session) => {
    repairsOps.addComment(session, idOf(form), field(form, 'body'));
  });
}

export async function updateRepairAction(form: FormData): Promise<never> {
  return runAction(back(form), (session) => {
    repairsOps.updateFields(session, idOf(form), {
      equipmentType: field(form, 'equipmentType'),
      brand: field(form, 'brand'),
      model: field(form, 'model'),
      message: field(form, 'message'),
      phone: field(form, 'phone'),
      email: field(form, 'email'),
    });
  });
}

export async function addRepairPhotoAction(form: FormData): Promise<never> {
  const files = form.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0);
  return runAction(back(form), async (session) => {
    if (files.length === 0) throw new ValidationError('Выберите файл JPG, PNG или WebP');
    for (const f of files) await repairsOps.addPhoto(session, idOf(form), new Uint8Array(await f.arrayBuffer()));
  });
}

export async function bulkRepairsAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    const ids = form.getAll('ids').map((v) => Number(v));
    const raw = field(form, 'staffId');
    repairsOps.bulk(session, ids, { type: 'assign', staffId: raw === '' ? null : Number(raw) });
  });
}
