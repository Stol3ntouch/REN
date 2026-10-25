import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { inquiriesOps, parseRequestFilters } from '@/domain/requests/sales-admin';
import { CHANNEL_LABELS, INQUIRY_CHANNELS, INQUIRY_LABELS, INQUIRY_STATUSES } from '@/domain/requests/workflow';
import type { RequestRow } from '@/server/db/repositories/requests';
import { requireStaffPage } from '@/ui/admin/guard';
import { DataTable, FilterPanel, FlashToast, FormField, PageHeader, Pagination, SelectField, type SearchParams } from '@/ui/admin/kit';
import { fmtTime } from '../_lib/ui';
import { bulkInquiriesAction } from './actions';
import { RequestStatusBadge } from './parts';

export const metadata: Metadata = { title: 'Обращения' };
export const dynamic = 'force-dynamic';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function InquiriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('inquiries.read');
  const sp = await searchParams;
  const filters = parseRequestFilters(sp, 'inquiries');
  const result = inquiriesOps.list(session, filters);
  const staff = inquiriesOps.staffForAssignment(session);
  const staffName = new Map(staff.map((s) => [s.id, s.label]));
  const canWrite = hasPermission(session, 'inquiries.write');

  return (
    <>
      <FlashToast ok={first(sp.ok)} error={first(sp.error)} />
      <PageHeader title="Обращения" description="Обратная связь, вопросы о товарах и заказы звонка. Заявки на ремонт — в отдельном разделе." />
      <FilterPanel basePath="/admin/inquiries" params={sp} title="Поиск и фильтры обращений">
        <FormField name="q" label="Поиск" type="search" defaultValue={filters.q ?? ''} maxLength={100} hint="Номер, имя, телефон, email, текст" />
        <SelectField
          name="channel"
          label="Канал"
          defaultValue={filters.channel ?? ''}
          placeholder="Все"
          options={INQUIRY_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }))}
        />
        <SelectField name="status" label="Статус" defaultValue={filters.status ?? ''} placeholder="Все" options={INQUIRY_STATUSES.map((s) => ({ value: s, label: INQUIRY_LABELS[s] }))} />
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
        caption="Обращения"
        basePath="/admin/inquiries"
        params={sp}
        sort={filters.sort ?? 'created'}
        dir={filters.dir ?? 'desc'}
        rows={result.rows}
        rowKey={(r) => r.id}
        selectable={canWrite}
        bulkFormId="bulk-inquiries"
        rowLabel={(r) => r.number}
        bulkActions={
          canWrite ? (
            <form id="bulk-inquiries" action={bulkInquiriesAction} className="ak-inline-form">
              <select name="staffId" aria-label="Ответственный для выбранных">
                <option value="">Снять ответственного</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button type="submit" name="bulk" value="assign" className="ak-btn ak-btn--sm">
                Назначить
              </button>
              <button type="submit" name="bulk" value="close" className="ak-btn ak-btn--sm">
                Закрыть
              </button>
            </form>
          ) : null
        }
        empty={{ title: 'Обращений не найдено', description: 'Измените условия поиска или сбросьте фильтры.' }}
        columns={[
          { key: 'number', header: 'Номер', sortKey: 'number', cell: (r) => <Link href={`/admin/inquiries/${r.id}`}>{r.number}</Link> },
          { key: 'channel', header: 'Канал', cell: (r) => CHANNEL_LABELS[r.kind] },
          { key: 'subject', header: 'Тема', hideOnNarrow: true, cell: (r) => r.subject ?? r.productName ?? (r.message ? `${r.message.slice(0, 60)}${r.message.length > 60 ? '…' : ''}` : '—') },
          { key: 'name', header: 'Имя', sortKey: 'name', cell: (r) => r.name },
          { key: 'contacts', header: 'Контакты', hideOnNarrow: true, cell: (r) => [r.phone, r.email].filter(Boolean).join(' · ') || '—' },
          { key: 'status', header: 'Статус', sortKey: 'status', cell: (r) => <RequestStatusBadge row={r} /> },
          { key: 'assigned', header: 'Ответственный', hideOnNarrow: true, cell: (r) => (r.assignedStaffId ? (staffName.get(r.assignedStaffId) ?? `№${r.assignedStaffId}`) : '—') },
          { key: 'created', header: 'Дата', sortKey: 'created', cell: (r) => fmtTime(r.createdAt) },
        ]}
        footer={<Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/inquiries" params={sp} />}
      />
    </>
  );
}
