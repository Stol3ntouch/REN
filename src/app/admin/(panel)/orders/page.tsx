import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { orderOps, parseOrderFilters } from '@/domain/ordering/admin-ops';
import { ORDER_STATUSES, STATUS_LABELS } from '@/domain/ordering/status';
import { formatRub } from '@/domain/pricing/format';
import { getDb } from '@/server/db/connection';
import { methodsRepo } from '@/server/db/repositories/methods';
import type { OrderRow } from '@/server/db/repositories/orders';
import { requireStaffPage } from '@/ui/admin/guard';
import { DataTable, FilterPanel, FlashToast, FormField, PageHeader, Pagination, SelectField, StatusBadge, buildHref, type SearchParams, type StatusTone } from '@/ui/admin/kit';
import { fmtTime } from '../_lib/ui';

export const metadata: Metadata = { title: 'Заказы' };
export const dynamic = 'force-dynamic';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

const TONE: Partial<Record<OrderRow['status'], StatusTone>> = {
  new: 'warning',
  confirmed: 'info',
  processing: 'info',
  shipped: 'info',
  ready_for_pickup: 'success',
  delivered: 'success',
  paid: 'success',
  cancelled: 'danger',
  payment_failed: 'danger',
  refunded: 'neutral',
};

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('orders.read');
  const sp = await searchParams;
  const filters = parseOrderFilters(sp);
  const result = orderOps.list(session, filters);
  const staff = orderOps.staffForAssignment(session);
  const staffName = new Map(staff.map((s) => [s.id, s.label]));
  const db = getDb();
  const delivery = methodsRepo.listDelivery(db, {});
  const payment = methodsRepo.listPayment(db, {});
  const canExport = hasPermission(session, 'export.run');

  return (
    <>
      <FlashToast ok={first(sp.ok)} error={first(sp.error)} />
      <PageHeader
        title="Заказы"
        actions={canExport ? <a className="ak-btn" href={buildHref('/admin/api/orders/export', sp, { page: null, pageSize: null })}>Экспорт CSV</a> : undefined}
      />
      <FilterPanel basePath="/admin/orders" params={sp} title="Поиск и фильтры заказов">
        <FormField name="q" label="Поиск" type="search" defaultValue={filters.q ?? ''} maxLength={100} hint="Номер, имя, телефон, email" />
        <SelectField name="status" label="Статус" defaultValue={filters.status ?? ''} placeholder="Все" options={ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
        <SelectField name="pay" label="Оплата" defaultValue={filters.paymentState ?? ''} placeholder="Любая" options={[{ value: 'paid', label: 'Оплачен' }, { value: 'unpaid', label: 'Не оплачен' }]} />
        <SelectField name="delivery" label="Получение" defaultValue={filters.deliveryCode ?? ''} placeholder="Любое" options={delivery.map((d) => ({ value: d.code, label: d.name }))} />
        <SelectField name="method" label="Способ оплаты" defaultValue={filters.paymentCode ?? ''} placeholder="Любой" options={payment.map((p) => ({ value: p.code, label: p.name }))} />
        <SelectField
          name="assigned"
          label="Ответственный"
          defaultValue={first(sp.assigned)}
          placeholder="Любой"
          options={[{ value: 'none', label: 'Не назначен' }, ...staff.map((s) => ({ value: String(s.id), label: s.label }))]}
        />
        <FormField name="min" label="Сумма от, руб." defaultValue={first(sp.min)} inputMode="decimal" />
        <FormField name="max" label="Сумма до, руб." defaultValue={first(sp.max)} inputMode="decimal" />
        <FormField name="from" label="С даты" type="date" defaultValue={first(sp.from)} />
        <FormField name="to" label="По дату" type="date" defaultValue={first(sp.to)} />
      </FilterPanel>
      <DataTable<OrderRow>
        caption="Список заказов"
        basePath="/admin/orders"
        params={sp}
        sort={filters.sort ?? 'created'}
        dir={filters.dir ?? 'desc'}
        rows={result.rows}
        rowKey={(o) => o.id}
        empty={{ title: 'Заказов не найдено', description: 'Измените условия поиска или сбросьте фильтры.' }}
        columns={[
          { key: 'number', header: 'Номер', sortKey: 'number', cell: (o) => <Link href={`/admin/orders/${o.number}`}>{o.number}</Link> },
          { key: 'date', header: 'Дата', sortKey: 'created', cell: (o) => fmtTime(o.createdAt) },
          { key: 'customer', header: 'Покупатель', sortKey: 'name', cell: (o) => `${o.contactName} · ${o.contactPhone}` },
          { key: 'status', header: 'Статус', sortKey: 'status', cell: (o) => <StatusBadge tone={TONE[o.status] ?? 'neutral'}>{STATUS_LABELS[o.status]}</StatusBadge> },
          { key: 'pay', header: 'Оплата', hideOnNarrow: true, cell: (o) => `${o.paymentName}${o.isPaid ? ' · оплачен' : ''}` },
          { key: 'assigned', header: 'Ответственный', hideOnNarrow: true, cell: (o) => (o.assignedStaffId ? (staffName.get(o.assignedStaffId) ?? `№${o.assignedStaffId}`) : '—') },
          { key: 'total', header: 'Сумма', sortKey: 'total', align: 'right', cell: (o) => formatRub(o.totalKopecks) },
        ]}
        footer={<Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/orders" params={sp} />}
      />
    </>
  );
}
