'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { contentOps } from '@/domain/content/ops';
import { previewOps } from '@/domain/content/ops-pages';
import { isListEntityKey, OPS_KEY, type ListEntityKey } from '@/domain/content/fields';
import { requireStaff } from '@/domain/admin/staff-session';
import { assertOrigin } from '@/server/http/origin';
import { AppError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';

/**
 * Действия над записями раздела «Контент». Origin, сессия и право content.write — runAction и сами операции
 * (contentOps.*), аудит пишут они же.
 */
const listEntity = (form: FormData): ListEntityKey => {
  const e = field(form, 'entity');
  if (!isListEntityKey(e)) throw new ValidationError('Раздел не найден');
  return e;
};
const idOf = (form: FormData): number => {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Запись не найдена');
  return id;
};
/** Куда вернуться: тот же список с теми же фильтрами (адрес приходит из формы, берутся только путь и query раздела). */
const backTo = (form: FormData, entity: string): string => {
  const raw = field(form, 'back');
  return raw.startsWith(`/admin/content/${entity}`) && !raw.includes('//') ? raw.replace(/([?&])(ok|error)=[^&]*/g, '').replace(/[?&]$/, '') : `/admin/content/${entity}`;
};

export async function duplicateEntityAction(form: FormData): Promise<never> {
  const entity = listEntity(form);
  const id = idOf(form);
  return runAction(backTo(form, entity), async (session) => {
    const ops = contentOps[OPS_KEY[entity]] as unknown as { duplicate(s: typeof session, id: number): Promise<{ id: number }> };
    await ops.duplicate(session, id);
    revalidatePath('/', 'layout');
  });
}

export async function deleteEntityAction(form: FormData): Promise<never> {
  const entity = listEntity(form);
  const id = idOf(form);
  return runAction(backTo(form, entity), async (session) => {
    const ops = contentOps[OPS_KEY[entity]] as unknown as { remove(s: typeof session, id: number): Promise<void> };
    await ops.remove(session, id);
    revalidatePath('/', 'layout');
  });
}

/** Скрыть или показать запись одним переключателем: страница — hidden_by_admin, остальное — публикация/статус. */
export async function toggleEntityAction(form: FormData): Promise<never> {
  const entity = listEntity(form);
  const id = idOf(form);
  const show = field(form, 'show') === '1';
  return runAction(backTo(form, entity), async (session) => {
    if (entity === 'pages') await contentOps.pages.setHidden(session, id, !show);
    else await contentOps.visibility.set(session, entity, id, show);
    revalidatePath('/', 'layout');
  });
}

export async function rollbackPageAction(form: FormData): Promise<never> {
  const id = idOf(form);
  const versionId = Number(field(form, 'version'));
  return runAction(`/admin/content/pages/${id}`, async (session) => {
    await contentOps.pages.rollback(session, id, versionId);
    revalidatePath('/', 'layout');
  });
}

/** Создаёт одноразовую ссылку предпросмотра и возвращает на форму с этой ссылкой. */
export async function previewLinkAction(form: FormData): Promise<never> {
  const kind = field(form, 'entity') === 'news' ? 'news' : 'pages';
  const id = idOf(form);
  const back = `/admin/content/${kind}/${id}`;
  let target = back;
  try {
    assertOrigin({ method: 'POST', headers: await headers() });
    const session = requireStaff(await cookies());
    target = `${back}?preview=${encodeURIComponent(previewOps.create(session, kind, id).url)}`;
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/admin/login');
    if (e instanceof AppError) target = `${back}?error=${encodeURIComponent(e.message)}`;
    else throw e;
  }
  redirect(target);
}

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
