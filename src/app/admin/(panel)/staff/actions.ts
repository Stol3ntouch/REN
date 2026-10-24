'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ValidationError } from '@/server/http/errors';
import { field, runAction, runStateAction } from '../_lib/run-action';
import { staffOps } from '../_lib/staff-ops';
import type { StaffFormState } from './state';

const targetId = (form: FormData): number => {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Сотрудник не найден');
  return id;
};

const rawPassword = (form: FormData): string => {
  const v = form.get('password');
  return typeof v === 'string' ? v : '';
};

/** Новый сотрудник: с паролем — сразу в список; без пароля — одноразовая ссылка-приглашение (показывается один раз). */
export async function createStaffAction(_prev: StaffFormState, form: FormData): Promise<StaffFormState> {
  const result = await runStateAction((session) =>
    staffOps.create(session, { email: field(form, 'email'), password: rawPassword(form), role: field(form, 'role'), name: field(form, 'name') }),
  );
  if (!result.ok) return { status: 'error', message: result.error };
  revalidatePath('/admin/staff');
  if (result.data.invite) return { status: 'invite', login: field(form, 'email').toLowerCase(), link: result.data.invite };
  redirect('/admin/staff?ok=1');
}

/** Имя и роль сотрудника. */
export async function updateStaffAction(form: FormData): Promise<never> {
  const id = targetId(form);
  return runAction(`/admin/staff/${id}`, (session) => {
    staffOps.setName(session, id, field(form, 'name'));
    const role = field(form, 'role');
    if (role) staffOps.setRole(session, id, role);
  });
}

/** Блокировка и возврат доступа (блокировка завершает все сессии). */
export async function setActiveAction(form: FormData): Promise<never> {
  const id = targetId(form);
  return runAction(`/admin/staff/${id}`, (session) => {
    staffOps.setActive(session, id, field(form, 'active') === '1');
  });
}

/** Ссылка сброса пароля: показывается администратору один раз (и уходит письмом, если логин — email). */
export async function issueResetLinkAction(_prev: StaffFormState, form: FormData): Promise<StaffFormState> {
  const result = await runStateAction((session) => staffOps.issueResetLink(session, targetId(form)));
  if (!result.ok) return { status: 'error', message: result.error };
  return { status: 'reset', link: result.data };
}
