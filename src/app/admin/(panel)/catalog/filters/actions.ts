'use server';

import { revalidatePath } from 'next/cache';
import { ValidationError } from '@/server/http/errors';
import { filterOps } from '../../_lib/filters-ops';
import { field, runAction } from '../../_lib/run-action';

const LIST = '/admin/catalog/filters';

function filterId(form: FormData): number {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Фильтр не найден');
  return id;
}

const optInt = (raw: string): number | undefined => (raw === '' ? undefined : Number(raw));

function input(form: FormData) {
  const attr = field(form, 'attributeId');
  const sort = field(form, 'sort');
  const kind = field(form, 'kind') as 'price';
  const config: { minProducts?: number; maxValues?: number } = {};
  const minProducts = optInt(field(form, 'minProducts'));
  const maxValues = optInt(field(form, 'maxValues'));
  if (minProducts !== undefined) config.minProducts = minProducts;
  if (maxValues !== undefined) config.maxValues = maxValues;
  return {
    kind,
    attributeId: kind === ('attribute' as string) && attr !== '' ? Number(attr) : null,
    label: field(form, 'label'),
    widget: field(form, 'widget') as 'checkbox',
    sort: sort === '' ? 0 : Number(sort),
    enabled: form.get('enabled') === 'on',
    config,
    categoryIds: form.getAll('categoryIds').map((v) => Number(typeof v === 'string' ? v : NaN)),
  };
}

function afterChange(): void {
  revalidatePath('/', 'layout');
}

export async function createFilterAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    filterOps.create(session, input(form));
    afterChange();
  });
}

export async function updateFilterAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, (session) => {
    filterOps.update(session, filterId(form), input(form));
    afterChange();
  });
}

export async function toggleFilterAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    filterOps.setEnabled(session, filterId(form), field(form, 'enabled') === '1');
    afterChange();
  });
}

/** Сдвиг фильтра на одну позицию: пересчитывает порядок всех фильтров (10, 20, 30…). */
export async function moveFilterAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    const id = filterId(form);
    const delta = field(form, 'dir') === 'up' ? -1 : 1;
    const ids = filterOps.list(session, { limit: 5000, offset: 0 }).rows.map((f) => f.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j] as number, ids[i] as number];
    filterOps.reorder(session, ids);
    afterChange();
  });
}

export async function deleteFilterAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    filterOps.remove(session, filterId(form));
    afterChange();
  });
}
