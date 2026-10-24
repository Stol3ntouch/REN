import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { ATTRIBUTE_TYPE_LABELS, isAttributeType } from '@/domain/catalog/attributes';
import type { AttributeListRow } from '@/server/db/repositories/attributes';
import { requireStaffPage } from '@/ui/admin/guard';
import { DataTable, FilterPanel, FlashToast, PageHeader, Pagination, parseListParams, SearchInput, SelectField, StatusBadge, type SearchParams } from '@/ui/admin/kit';
import { attributeOps } from '../../_lib/attributes-ops';

export const metadata: Metadata = { title: 'Характеристики' };
export const dynamic = 'force-dynamic';

const SORTS = ['name', 'code', 'type', 'sort', 'products'] as const;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function AttributesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  const list = parseListParams(sp, { sorts: SORTS, defaultSort: 'sort' });
  const type = first(sp.type);
  const filterable = first(sp.filterable);
  const result = attributeOps.list(session, {
    q: list.q || undefined,
    type: isAttributeType(type) ? type : undefined,
    filterable: filterable === '1' ? true : filterable === '0' ? false : undefined,
    sort: list.sort as (typeof SORTS)[number],
    dir: list.dir,
    limit: list.pageSize,
    offset: (list.page - 1) * list.pageSize,
  });
  const canWrite = hasPermission(session.role, 'catalog.write');

  return (
    <>
      <FlashToast ok={first(sp.ok)} error={first(sp.error)} />
      <PageHeader
        title="Характеристики"
        description="Тип, единица, допустимые значения и участие в фильтрах и сравнении. Данные прежнего импорта сохраняются как строки."
        actions={canWrite ? <Link href="/admin/catalog/attributes/new" className="ak-btn ak-btn--primary">Добавить характеристику</Link> : undefined}
      />
      <div className="ak-toolbar">
        <SearchInput label="Поиск характеристик" placeholder="Название или код" defaultValue={list.q} />
      </div>
      <FilterPanel basePath="/admin/catalog/attributes" params={sp} title="Фильтр характеристик">
        <SelectField name="type" label="Тип" defaultValue={type} placeholder="Любой" options={Object.entries(ATTRIBUTE_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
        <SelectField name="filterable" label="В фильтрах" defaultValue={filterable} placeholder="Любые" options={[{ value: '1', label: 'Участвуют' }, { value: '0', label: 'Не участвуют' }]} />
      </FilterPanel>
      <DataTable<AttributeListRow>
        caption="Характеристики"
        basePath="/admin/catalog/attributes"
        params={sp}
        sort={list.sort}
        dir={list.dir}
        rows={result.rows}
        rowKey={(a) => a.id}
        empty={{ title: 'Характеристик нет', description: 'Они создаются при импорте каталога или вручную.' }}
        columns={[
          { key: 'name', header: 'Название', sortKey: 'name', cell: (a) => <Link href={`/admin/catalog/attributes/${a.id}`}>{a.name}</Link> },
          { key: 'code', header: 'Код', sortKey: 'code', hideOnNarrow: true, cell: (a) => <code>{a.code}</code> },
          { key: 'type', header: 'Тип', sortKey: 'type', cell: (a) => ATTRIBUTE_TYPE_LABELS[a.type] },
          { key: 'unit', header: 'Единица', hideOnNarrow: true, cell: (a) => a.unit ?? '—' },
          { key: 'products', header: 'Товаров', sortKey: 'products', align: 'right', cell: (a) => a.productCount },
          {
            key: 'flags',
            header: 'Использование',
            cell: (a) => (
              <>
                {a.filterable ? <StatusBadge tone="info">Фильтр</StatusBadge> : null} {a.comparable ? <StatusBadge tone="neutral">Сравнение</StatusBadge> : null}{' '}
                {a.required ? <StatusBadge tone="warning">Обязательная</StatusBadge> : null}
              </>
            ),
          },
          { key: 'sort', header: 'Порядок', sortKey: 'sort', align: 'right', hideOnNarrow: true, cell: (a) => a.sort },
        ]}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={result.total} basePath="/admin/catalog/attributes" params={sp} />}
      />
    </>
  );
}
