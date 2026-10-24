import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable, FilterPanel, FormField, PageHeader, Pagination, SelectField, StatusBadge, parseListParams, type DataTableColumn } from '@/ui/admin/kit';
import { FlashToast } from '@/ui/admin/kit/Toaster';
import { requireStaffPage } from '@/ui/admin/guard';
import { getDb } from '@/server/db/connection';
import { rolesRepo } from '@/server/db/repositories/roles';
import type { StaffListRow } from '@/server/db/repositories/staff-admin';
import { staffOps } from '../_lib/staff-ops';
import { fmtTime, str } from '../_lib/ui';

export const metadata: Metadata = { title: 'Пользователи' };
export const dynamic = 'force-dynamic';

const SORTS = ['login', 'name', 'role', 'created', 'last_login'] as const;

export default async function AdminStaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('users.manage');
  const sp = await searchParams;
  const lp = parseListParams(sp, { sorts: SORTS, defaultSort: 'login' });
  const roleId = Number(str(sp.role));
  const status = str(sp.status);
  const { rows, total } = staffOps.search(session, {
    q: lp.q,
    roleId: Number.isInteger(roleId) && roleId > 0 ? roleId : undefined,
    active: status === 'active' ? true : status === 'blocked' ? false : undefined,
    sort: (lp.sort ?? 'login') as (typeof SORTS)[number],
    dir: lp.dir,
    limit: lp.pageSize,
    offset: (lp.page - 1) * lp.pageSize,
  });
  const roles = rolesRepo.list(getDb());

  const columns: DataTableColumn<StaffListRow>[] = [
    {
      key: 'login',
      header: 'Пользователь',
      sortKey: 'login',
      cell: (s) => (
        <>
          <Link href={`/admin/staff/${s.id}`}>
            <strong>{s.name || s.email}</strong>
          </Link>
          {s.name ? <div className="ak-field__hint">{s.email}</div> : null}
        </>
      ),
    },
    { key: 'role', header: 'Роль', sortKey: 'role', cell: (s) => s.roleName },
    { key: 'status', header: 'Статус', cell: (s) => <StatusBadge tone={s.active ? 'success' : 'danger'}>{s.active ? 'Активен' : 'Заблокирован'}</StatusBadge> },
    { key: 'last', header: 'Последний вход', sortKey: 'last_login', hideOnNarrow: true, cell: (s) => fmtTime(s.lastLoginAt) },
    { key: 'created', header: 'Создан', sortKey: 'created', hideOnNarrow: true, cell: (s) => fmtTime(s.createdAt) },
  ];

  return (
    <>
      <PageHeader
        title="Пользователи"
        description="Сотрудники админки: роли, блокировка и сброс пароля"
        actions={
          <Link href="/admin/staff/new" className="ak-btn ak-btn--primary">
            Добавить пользователя
          </Link>
        }
      />
      <FlashToast ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      <FilterPanel basePath="/admin/staff" params={sp}>
        <FormField name="q" label="Поиск" defaultValue={lp.q} placeholder="Логин или имя" maxLength={100} />
        <SelectField name="role" label="Роль" defaultValue={str(sp.role)} placeholder="Все роли" options={roles.map((r) => ({ value: String(r.id), label: r.name }))} />
        <SelectField
          name="status"
          label="Статус"
          defaultValue={status}
          placeholder="Любой"
          options={[
            { value: 'active', label: 'Активные' },
            { value: 'blocked', label: 'Заблокированные' },
          ]}
        />
      </FilterPanel>
      <DataTable
        caption="Сотрудники"
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        basePath="/admin/staff"
        params={sp}
        sort={lp.sort}
        dir={lp.dir}
        empty={{ title: 'Никого не найдено', description: 'Измените условия поиска или добавьте пользователя.' }}
        footer={<Pagination page={lp.page} pageSize={lp.pageSize} total={total} basePath="/admin/staff" params={sp} />}
      />
    </>
  );
}
