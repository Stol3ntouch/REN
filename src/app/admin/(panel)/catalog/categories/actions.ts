'use server';

import { revalidatePath } from 'next/cache';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../../_lib/run-action';
import { categorySeoOps } from '../category-seo-ops';
import { categoryVisibilityOps } from '../category-visibility-ops';

/** Сохранение SEO категории. Origin, сессия и право catalog.write проверяются на сервере (runAction → categorySeoOps.update). */
export async function saveCategorySeoAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  const valid = Number.isInteger(id) && id > 0;
  return runAction(valid ? `/admin/catalog/categories/${id}` : '/admin/catalog/categories', (session) => {
    if (!valid) throw new ValidationError('Категория не найдена');
    categorySeoOps.update(session, id, {
      seoTitle: field(form, 'seoTitle'),
      seoDescription: field(form, 'seoDescription'),
      h1: field(form, 'h1'),
      seoText: field(form, 'seoText'),
    });
  });
}

/**
 * Скрыть (hidden=1) или показать (hidden=0) категорию с подкатегориями. Origin, сессия и право catalog.write
 * проверяются на сервере (runAction → categoryVisibilityOps.setHidden). Витрина кэшируется — сбрасываем публичное.
 */
export async function setCategoryHiddenAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  const hidden = field(form, 'hidden') === '1';
  return runAction('/admin/catalog/categories', (session) => {
    categoryVisibilityOps.setHidden(session, id, hidden);
    revalidatePath('/', 'layout');
  });
}
