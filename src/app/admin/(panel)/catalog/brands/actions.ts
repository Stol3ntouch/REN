'use server';

import { revalidatePath } from 'next/cache';
import { ValidationError } from '@/server/http/errors';
import { brandOps, type LogoChange } from '../../_lib/brands-ops';
import { field, runAction } from '../../_lib/run-action';

const LIST = '/admin/catalog/brands';

function brandId(form: FormData): number {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Бренд не найден');
  return id;
}

function input(form: FormData) {
  const sort = field(form, 'sort');
  return {
    name: field(form, 'name'),
    slug: field(form, 'slug'),
    description: field(form, 'description'),
    siteUrl: field(form, 'siteUrl'),
    published: form.get('published') === 'on',
    sort: sort === '' ? 0 : Number(sort),
    seoTitle: field(form, 'seoTitle'),
    seoDescription: field(form, 'seoDescription'),
  };
}

/** Идентификаторы товаров из флажков формы (`ids`). */
function attachIds(form: FormData): number[] {
  return form.getAll('ids').map((v) => Number(typeof v === 'string' ? v : NaN));
}

async function logoOf(form: FormData): Promise<LogoChange> {
  const file = form.get('logo');
  if (file instanceof File && file.size > 0) return { bytes: new Uint8Array(await file.arrayBuffer()) };
  return form.get('logo_clear') === '1' ? { remove: true } : undefined;
}

export async function createBrandAction(form: FormData): Promise<never> {
  return runAction(LIST, async (session) => {
    await brandOps.create(session, input(form), await logoOf(form));
  });
}

export async function updateBrandAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, async (session) => {
    await brandOps.update(session, brandId(form), input(form), await logoOf(form));
  });
}

export async function archiveBrandAction(form: FormData): Promise<never> {
  return runAction(field(form, 'back').startsWith(LIST) ? field(form, 'back') : LIST, (session) => {
    brandOps.setArchived(session, brandId(form), field(form, 'archived') === '1');
  });
}

export async function deleteBrandAction(form: FormData): Promise<never> {
  return runAction(LIST, (session) => {
    const move = field(form, 'moveTo');
    brandOps.remove(session, brandId(form), { moveToId: move === '' ? null : Number(move), detach: field(form, 'detach') === '1' });
    revalidatePath('/', 'layout');
  });
}

export async function attachProductsAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, (session) => {
    brandOps.attachProducts(session, brandId(form), attachIds(form));
    revalidatePath('/', 'layout');
  });
}

export async function detachProductsAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, (session) => {
    brandOps.detachProducts(session, brandId(form), attachIds(form));
    revalidatePath('/', 'layout');
  });
}
