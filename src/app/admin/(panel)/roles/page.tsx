import type { Metadata } from 'next';
import Link from 'next/link';
import { rolesService } from '@/domain/admin/roles';
import { ConfirmButton, DataTable, FormField, PageHeader, StatusBadge, type DataTableColumn } from '@/ui/admin/kit';
import { FlashToast } from '@/ui/admin/kit/Toaster';
import { requireStaffPage } from '@/ui/admin/guard';
import type { RoleListRow } from '@/server/db/repositories/roles';
import { str } from '../_lib/ui';
import { createRoleAction, deleteRoleAction } from './actions';

export const metadata: Metadata = { title: 'Роли' };
export const dynamic = 'force-dynamic';

export default async function AdminRolesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('roles.manage');
  const sp = await searchParams;
  const roles = rolesService.list(session);

  const columns: DataTableColumn<RoleListRow>[] = [
    {
      key: 'name',
      header: 'Роль',
      cell: (r) => (
        <>
          <Link href={`/admin/roles/${r.id}`}>
            <strong>{r.name}</strong>
          </Link>{' '}
          {r.isSystem ? <StatusBadge tone="info">Системная</StatusBadge> : null}
        </>
      ),
    },
    { key: 'staff', header: 'Сотрудников', align: 'right', cell: (r) => r.staffCount },
    { key: 'perms', header: 'Разрешений', align: 'right', hideOnNarrow: true, cell: (r) => (r.code === 'super_admin' ? 'все' : r.permissionCount) },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      cell: (r) => (
        <div className="ak-toolbar">
          <Link href={`/admin/roles/${r.id}`} className="ak-btn ak-btn--sm ak-btn--outline">
            Открыть
          </Link>
          {!r.isSystem && r.staffCount === 0 ? (
            <form action={deleteRoleAction}>
              <input type="hidden" name="id" value={r.id} />
              <ConfirmButton title={`Удалить роль «${r.name}»?`} description="Роль будет удалена без возможности восстановления." confirmLabel="Удалить" className="ak-btn ak-btn--sm ak-btn--danger-outline">
                Удалить
              </ConfirmButton>
            </form>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Роли" description="Наборы разрешений для сотрудников. Роль суперадминистратора неизменяема." />
      <FlashToast ok={str(sp.ok)} error={str(sp.error)} okText="Готово." />
      <DataTable caption="Роли сотрудников" columns={columns} rows={roles} rowKey={(r) => r.id} basePath="/admin/roles" params={sp} />
      <form action={createRoleAction} className="ak-card" aria-labelledby="role-new-h">
        <h2 id="role-new-h">Новая роль</h2>
        <div className="ak-form-grid">
          <FormField name="name" label="Название" required minLength={2} maxLength={60} hint="Разрешения отмечаются на странице роли после создания." />
        </div>
        <button type="submit" className="ak-btn ak-btn--primary">
          Создать роль
        </button>
      </form>
    </>
  );
}
