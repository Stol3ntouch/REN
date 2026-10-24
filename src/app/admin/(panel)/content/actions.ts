'use server';

import { revalidatePath } from 'next/cache';
import { contentOps } from '@/domain/content/ops';
import { field, runAction } from '../_lib/run-action';

/**
 * Скрыть (hidden=1) или вернуть (hidden=0) страницу сайта. Origin, сессия и право content.write — runAction и contentOps.pages.setHidden;
 * политику ПДн сервер скрыть не даст (ValidationError → сообщение над списком).
 */
export async function setPageHiddenAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  const hidden = field(form, 'hidden') === '1';
  return runAction('/admin/content/pages', async (session) => {
    await contentOps.pages.setHidden(session, id, hidden);
    revalidatePath('/', 'layout');
  });
}

/** Скрыть или показать раздел целиком (новости, акции, услуги). */
export async function setSectionHiddenAction(form: FormData): Promise<never> {
  const section = field(form, 'section');
  const hidden = field(form, 'hidden') === '1';
  return runAction(`/admin/content/${section === 'news' || section === 'promotions' || section === 'services' ? section : 'pages'}`, async (session) => {
    await contentOps.sections.setHidden(session, section, hidden);
    revalidatePath('/', 'layout');
  });
}
