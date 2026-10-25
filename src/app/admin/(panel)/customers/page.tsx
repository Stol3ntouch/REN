import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { formatRub } from '@/domain/pricing/format';
import type { CustomerRow } from '@/server/db/repositories/customers-admin';
import { requireStaffPage } from '@/ui/admin/guard';
import { DataTable, FilterPanel, FlashToast, FormField, PageHeader, Pagination, SelectField, StatusBadge, buildHref, type SearchParams } from '@/ui/admin/kit';
import { CUSTOMER_STATUS_LABELS, customersOps, parseCustomerFilters } from '../_lib/customers-ops';
import { fmtTime } from '../_lib/ui';

export const metadata: Metadata = { title: 'Клиенты' };
export const dynamic = 'force-dynamic';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('customers.read');
  const sp = await searchParams;
  const filters = parseCustomerFilters(sp);
  const result = customersOps.list(session, filters);
  const canExport = hasPermission(session, 'export.run');

  return (
    <>
      <FlashToast ok={first(sp.ok)} error={first(sp.error)} />
      <PageHeader
        title="Клиенты"
        description="Зарегистрированные покупатели. Пароли и токены здесь не показываются."
        actions={canExport ? <a className="ak-btn" href={buildHref('/admin/api/customers/export', sp, { page: null, pageSize: null })}>Экспорт CSV</a> : undefined}
      />
      <FilterPanel basePath="/admin/customers" params={sp} title="Поиск и фильтры клиентов">
        <FormField name="q" label="Поиск" type="search" defaultValue={filters.q ?? ''} maxLength={100} hint="Имя, телефон, email" />
        <SelectField
          name="status"
          label="Статус"
          defaultValue={filters.status ?? ''}
          placeholder="Любой"
          options={(Object.keys(CUSTOMER_STATUS_LABELS) as Array<keyof typeof CUSTOMER_STATUS_LABELS>).map((s) => ({ value: s, label: CUSTOMER_STATUS_LABELS[s] }))}
        />
        <SelectField name="orders" label="Заказы" defaultValue={first(sp.orders)} placeholder="Все" options={[{ value: 'yes', label: 'Есть заказы' }, { value: 'no', label: 'Без заказов' }]} />
        <FormField name="from" label="Регистрация с" type="date" defaultValue={first(sp.from)} />
        <FormField name="to" label="Регистрация по" type="date" defaultValue={first(sp.to)} />
      </FilterPanel>
      <DataTable<CustomerRow>
        caption="Клиенты"
        basePath="/admin/customers"
        params={sp}
        sort={filters.sort ?? 'registered'}
        dir={filters.dir ?? 'desc'}
        rows={result.rows}
        rowKey={(c) => c.id}
        empty={{ title: 'Клиентов не найдено', description: 'Измените условия поиска или сбросьте фильтры.' }}
        columns={[
          { key: 'name', header: 'Имя', sortKey: 'name', cell: (c) => <Link href={`/admin/customers/${c.id}`}>{c.name ?? c.email}</Link> },
          { key: 'phone', header: 'Телефон', cell: (c) => c.phone ?? '—' },
          { key: 'email', header: 'Email', hideOnNarrow: true, cell: (c) => c.email },
          { key: 'registered', header: 'Регистрация', sortKey: 'registered', hideOnNarrow: true, cell: (c) => fmtTime(c.createdAt) },
          { key: 'orders', header: 'Заказов', sortKey: 'orders', align: 'right', cell: (c) => c.ordersCount },
          { key: 'spent', header: 'Сумма покупок', sortKey: 'spent', align: 'right', cell: (c) => formatRub(c.spentKopecks) },
          { key: 'status', header: 'Статус', cell: (c) => <StatusBadge tone={c.status === 'blocked' ? 'danger' : c.status === 'vip' ? 'info' : 'success'}>{CUSTOMER_STATUS_LABELS[c.status]}</StatusBadge> },
        ]}
        footer={<Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/customers" params={sp} />}
      />
    </>
  );
}
