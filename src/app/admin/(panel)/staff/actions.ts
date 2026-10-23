'use server';

import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';
import { staffOps } from '../_lib/staff-ops';

const targetId = (form: FormData): number => {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Сотрудник не найден');
  return id;
};

export async function createStaffAction(form: FormData): Promise<never> {
  return runAction('/admin/staff', async (session) => {
    await staffOps.create(session, { email: field(form, 'email'), password: String(form.get('password') ?? ''), role: field(form, 'role'), name: field(form, 'name') || undefined });
  });
}

export async function setRoleAction(form: FormData): Promise<never> {
  return runAction('/admin/staff', (session) => {
    staffOps.setRole(session, targetId(form), field(form, 'role') as 'admin' | 'manager');
  });
}

export async function setActiveAction(form: FormData): Promise<never> {
  return runAction('/admin/staff', (session) => {
    staffOps.setActive(session, targetId(form), field(form, 'active') === '1');
  });
}
