'use server';

import { rolesService } from '@/domain/admin/roles';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../_lib/run-action';

const roleId = (form: FormData): number => {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Роль не найдена');
  return id;
};

/** Создать свою роль (без прав; права отмечаются матрицей на странице роли). */
export async function createRoleAction(form: FormData): Promise<never> {
  return runAction('/admin/roles', (session) => {
    rolesService.create(session, { name: field(form, 'name') });
  });
}

export async function renameRoleAction(form: FormData): Promise<never> {
  const id = roleId(form);
  return runAction(`/admin/roles/${id}`, (session) => {
    rolesService.rename(session, id, field(form, 'name'));
  });
}

/** Копия роли с теми же правами под новым названием. */
export async function duplicateRoleAction(form: FormData): Promise<never> {
  const id = roleId(form);
  return runAction('/admin/roles', (session) => {
    rolesService.duplicate(session, id, field(form, 'name'));
  });
}

export async function deleteRoleAction(form: FormData): Promise<never> {
  const id = roleId(form);
  return runAction('/admin/roles', (session) => {
    rolesService.remove(session, id);
  });
}

/** Матрица разрешений: отмеченные флажки `permission` становятся набором прав роли. */
export async function setRolePermissionsAction(form: FormData): Promise<never> {
  const id = roleId(form);
  const checked = form.getAll('permission').filter((v): v is string => typeof v === 'string');
  return runAction(`/admin/roles/${id}`, (session) => {
    rolesService.setPermissions(session, id, checked);
  });
}
