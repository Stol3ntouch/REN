import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { rolesService } from '@/domain/admin/roles';
import { ConfirmButton, FormField, PageHeader, SaveBar, StatusBadge, UnsavedChangesGuard } from '@/ui/admin/kit';
import { FlashToast } from '@/ui/admin/kit/Toaster';
import { requireStaffPage } from '@/ui/admin/guard';
import { NotFoundError } from '@/server/http/errors';
import { str } from '../../_lib/ui';
import { deleteRoleAction, duplicateRoleAction, renameRoleAction, setRolePermissionsAction } from '../actions';
import { PermissionMatrix } from '../PermissionMatrix';

export const metadata: Metadata = { title: 'Роль' };
export const dynamic = 'force-dynamic';

export default async function AdminRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireStaffPage('roles.manage');
  const { id: rawId } = await params;
  const sp = await searchParams;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) notFound();
  let view;
  try {
    view = rolesService.get(session, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { role, permissions, staffCount, locked } = view;

  return (
    <>
      <PageHeader
        title={role.name}
        description={
          <>
            {role.isSystem ? <StatusBadge tone="info">Системная роль</StatusBadge> : <StatusBadge tone="neutral">Своя роль</StatusBadge>} · сотрудников: {staffCount}
          </>
        }
      />
      <FlashToast ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      {locked ? <p className="ak-field__hint">У суперадминистратора всегда есть все разрешения. Эту роль нельзя менять, копировать и удалять.</p> : null}

      <form id="role-perms-form" action={setRolePermissionsAction} className="ak-card" aria-labelledby="role-perms-h">
        <h2 id="role-perms-h">Разрешения</h2>
        <input type="hidden" name="id" value={role.id} />
        <PermissionMatrix initial={permissions} locked={locked} held={session.permissions ?? []} />
        {locked ? null : <SaveBar sticky cancelHref="/admin/roles" />}
      </form>
      <UnsavedChangesGuard formId="role-perms-form" />

      {locked ? null : (
        <div className="ak-grid-2">
          <form action={renameRoleAction} className="ak-card" aria-labelledby="role-rename-h">
            <h2 id="role-rename-h">Название</h2>
            <input type="hidden" name="id" value={role.id} />
            <FormField name="name" label="Название роли" defaultValue={role.name} required minLength={2} maxLength={60} />
            <button type="submit" className="ak-btn ak-btn--outline">
              Переименовать
            </button>
          </form>

          <form action={duplicateRoleAction} className="ak-card" aria-labelledby="role-copy-h">
            <h2 id="role-copy-h">Дублировать</h2>
            <input type="hidden" name="id" value={role.id} />
            <FormField name="name" label="Название копии" defaultValue={`${role.name} (копия)`} required minLength={2} maxLength={60} />
            <button type="submit" className="ak-btn ak-btn--outline">
              Создать копию
            </button>
          </form>

          {!role.isSystem && staffCount === 0 ? (
            <form action={deleteRoleAction} className="ak-card" aria-labelledby="role-del-h">
              <h2 id="role-del-h">Удаление</h2>
              <input type="hidden" name="id" value={role.id} />
              <p className="ak-field__hint">Роль не назначена ни одному сотруднику, её можно удалить.</p>
              <ConfirmButton title={`Удалить роль «${role.name}»?`} description="Действие необратимо." confirmLabel="Удалить">
                Удалить роль
              </ConfirmButton>
            </form>
          ) : null}
        </div>
      )}
    </>
  );
}
