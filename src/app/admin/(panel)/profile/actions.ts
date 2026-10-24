'use server';

import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { hashToken } from '@/domain/customers/session';
import { field, runAction } from '../_lib/run-action';
import { profileOps } from './profile-ops';

/** Сохранить имя. Любой сотрудник правит только себя: сессия берётся из cookie, а не из формы. */
export async function updateProfileAction(form: FormData): Promise<void> {
  await runAction('/admin/profile', (session) => {
    profileOps.updateName(session, { name: field(form, 'name') });
  });
}

/** Сменить свой пароль; остальные сессии завершаются, текущая остаётся. */
export async function changePasswordAction(form: FormData): Promise<void> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const raw = (name: string): string => {
    const v = form.get(name);
    return typeof v === 'string' ? v : '';
  };
  await runAction('/admin/profile?saved=password', async (session) => {
    await profileOps.changePassword(session, { current: raw('current'), next: raw('next'), confirm: raw('confirm') }, { keepTokenHash: token ? hashToken(token) : null });
  });
}
