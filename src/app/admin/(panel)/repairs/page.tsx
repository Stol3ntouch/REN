import type { Metadata } from 'next';
import Link from 'next/link';
import { repairsOps } from '@/domain/requests/sales-admin';
import { parseRequestFilters } from '@/domain/requests/sales-admin';
import { REPAIR_LABELS, REPAIR_STATUSES } from '@/domain/requests/workflow';
import type { RequestRow } from '@/server/db/repositories/requests';
import { hasPermission } from '@/domain/admin/permissions';
import { requireStaffPage } from '@/ui/admin/guard';
import { DataTable, FilterPanel, FlashToast, FormField, PageHeader, Pagination, SelectField, type SearchParams } from '@/ui/admin/kit';
import { fmtTime } from '../_lib/ui';
import { RequestStatusBadge } from '../inquiries/parts';
import { bulkRepairsAction } from './actions';

export const metadata: Metadata = { title: 'Заявки на ремонт' };
export const dynamic = 'force-dynamic';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function RepairsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('repair.write');
  const sp = await searchParams;
  const filters = parseRequestFilters(sp, 'repairs');
  const result = repairsOps.list(session, filters);
  const staff = repairsOps.staffForAssignment(session);
  const staffName = new Map(staff.map((s) => [s.id, s.label]));
  const canWrite = hasPermission(session, 'repair.write');

  return (
    <>
      <FlashToast ok={first(sp.ok)} error={first(sp.error)} />
      <PageHeader title="Заявки на ремонт" description="Приём техники в ремонт: диагностика, согласование, ремонт, выдача." />
      <FilterPanel basePath="/admin/repairs" params={sp} title="Поиск и фильтры заявок">
        <FormField name="q" label="Поиск" type="search" defaultValue={filters.q ?? ''} maxLength={100} hint="Номер, имя, телефон, модель, описание" />
        <SelectField name="status" label="Статус" defaultValue={filters.status ?? ''} placeholder="Все" options={REPAIR_STATUSES.map((s) => ({ value: s, label: REPAIR_LABELS[s] }))} />
        <SelectField
          name="assigned"
          label="Ответственный"
          defaultValue={first(sp.assigned)}
          placeholder="Любой"
          options={[{ value: 'none', label: 'Не назначен' }, ...staff.map((s) => ({ value: String(s.id), label: s.label }))]}
        />
        <FormField name="from" label="С даты" type="date" defaultValue={first(sp.from)} />
        <FormField name="to" label="По дату" type="date" defaultValue={first(sp.to)} />
      </FilterPanel>
      <DataTable<RequestRow>
        caption="Заявки на ремонт"
        basePath="/admin/repairs"
        params={sp}
        sort={filters.sort ?? 'created'}
        dir={filters.dir ?? 'desc'}
        rows={result.rows}
        rowKey={(r) => r.id}
        selectable={canWrite}
        bulkFormId="bulk-repairs"
        rowLabel={(r) => r.number}
        bulkActions={
          canWrite ? (
            <form id="bulk-repairs" action={bulkRepairsAction} className="ak-inline-form">
              <select name="staffId" aria-label="Ответственный для выбранных">
                <option value="">Снять ответственного</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="ak-btn ak-btn--sm">
                Назначить
              </button>
            </form>
          ) : null
        }
        empty={{ title: 'Заявок на ремонт не найдено', description: 'Измените условия поиска или сбросьте фильтры.' }}
        columns={[
          { key: 'number', header: 'Номер', sortKey: 'number', cell: (r) => <Link href={`/admin/repairs/${r.id}`}>{r.number}</Link> },
          { key: 'name', header: 'Клиент', sortKey: 'name', cell: (r) => r.name },
          { key: 'contacts', header: 'Телефон / email', hideOnNarrow: true, cell: (r) => [r.phone, r.email].filter(Boolean).join(' · ') || '—' },
          { key: 'tech', header: 'Техника', cell: (r) => [r.equipmentType, r.repairBrand, r.repairModel].filter(Boolean).join(' · ') || '—' },
          { key: 'status', header: 'Статус', sortKey: 'status', cell: (r) => <RequestStatusBadge row={r} /> },
          { key: 'assigned', header: 'Ответственный', hideOnNarrow: true, cell: (r) => (r.assignedStaffId ? (staffName.get(r.assignedStaffId) ?? `№${r.assignedStaffId}`) : '—') },
          { key: 'created', header: 'Поступила', sortKey: 'created', cell: (r) => fmtTime(r.createdAt) },
        ]}
        footer={<Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/repairs" params={sp} />}
      />
    </>
  );
}
