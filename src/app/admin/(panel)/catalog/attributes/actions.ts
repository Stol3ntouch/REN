'use server';

import { revalidatePath } from 'next/cache';
import { ValidationError } from '@/server/http/errors';
import { attributeOps } from '../../_lib/attributes-ops';
import { field, runAction } from '../../_lib/run-action';

const LIST = '/admin/catalog/attributes';

function attributeId(form: FormData, name = 'id'): number {
  const id = Number(field(form, name));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Характеристика не найдена');
  return id;
}

function input(form: FormData) {
  const sort = field(form, 'sort');
  return {
    name: field(form, 'name'),
    code: field(form, 'code'),
    type: field(form, 'type') as 'string',
    unit: field(form, 'unit'),
    required: form.get('required') === 'on',
    filterable: form.get('filterable') === 'on',
    comparable: form.get('comparable') === 'on',
    sort: sort === '' ? 0 : Number(sort),
    categoryIds: form.getAll('categoryIds').map((v) => Number(typeof v === 'string' ? v : NaN)),
    allowedValues: field(form, 'allowedValues')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  };
}

const idBack = (form: FormData) => {
  const id = Number(field(form, 'id'));
  return `${LIST}/${Number.isInteger(id) ? id : ''}`;
};

export async function createAttributeAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    attributeOps.create(session, input(form));
    revalidatePath('/', 'layout');
  });
}

export async function updateAttributeAction(form: FormData): Promise<never> {
  return runAction(idBack(form), (session) => {
    attributeOps.update(session, attributeId(form), input(form));
    revalidatePath('/', 'layout');
  });
}

export async function deleteAttributeAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    attributeOps.remove(session, attributeId(form), { withValues: field(form, 'withValues') === '1' });
    revalidatePath('/', 'layout');
  });
}

export async function mergeAttributesAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    attributeOps.merge(session, attributeId(form, 'id'), attributeId(form, 'targetId'));
    revalidatePath('/', 'layout');
  });
}
