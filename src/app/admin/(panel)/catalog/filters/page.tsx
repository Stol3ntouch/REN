import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { FILTER_KIND_LABELS, FILTER_KINDS, FILTER_WIDGET_LABELS } from '@/domain/catalog/filters';
import type { FilterListRow } from '@/server/db/repositories/filters';
import { requireStaffPage } from '@/ui/admin/guard';
import { DataTable, FilterPanel, FlashToast, PageHeader, Pagination, parseListParams, SearchInput, SelectField, StatusBadge, type SearchParams } from '@/ui/admin/kit';
import { filterOps } from '../../_lib/filters-ops';
import { moveFilterAction, toggleFilterAction } from './actions';

export const metadata: Metadata = { title: 'Фильтры каталога' };
export const dynamic = 'force-dynamic';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function FiltersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  const list = parseListParams(sp, { defaultPageSize: 50 });
  const kind = first(sp.kind);
  const enabled = first(sp.enabled);
  const result = filterOps.list(session, {
    q: list.q || undefined,
    kind: (FILTER_KINDS as readonly string[]).includes(kind) ? (kind as (typeof FILTER_KINDS)[number]) : undefined,
    enabled: enabled === '1' ? true : enabled === '0' ? false : undefined,
    limit: list.pageSize,
    offset: (list.page - 1) * list.pageSize,
  });
  const canWrite = hasPermission(session.role, 'catalog.write');

  return (
    <>
      <FlashToast ok={first(sp.ok)} error={first(sp.error)} />
      <PageHeader
        title="Фильтры каталога"
        description="Включённые фильтры в этом порядке показываются на сайте в панели фильтров категории и действительно сужают выдачу."
        actions={canWrite ? <Link href="/admin/catalog/filters/new" className="ak-btn ak-btn--primary">Добавить фильтр</Link> : undefined}
      />
      <div className="ak-toolbar">
        <SearchInput label="Поиск фильтров" placeholder="Название фильтра или характеристики" defaultValue={list.q} />
      </div>
      <FilterPanel basePath="/admin/catalog/filters" params={sp} title="Отбор фильтров">
        <SelectField name="kind" label="Вид" defaultValue={kind} placeholder="Любой" options={FILTER_KINDS.map((k) => ({ value: k, label: FILTER_KIND_LABELS[k] }))} />
        <SelectField name="enabled" label="Состояние" defaultValue={enabled} placeholder="Любое" options={[{ value: '1', label: 'Включённые' }, { value: '0', label: 'Выключенные' }]} />
      </FilterPanel>
      <DataTable<FilterListRow>
        caption="Фильтры каталога"
        basePath="/admin/catalog/filters"
        params={sp}
        rows={result.rows}
        rowKey={(f) => f.id}
        empty={{ title: 'Фильтров нет', description: 'Добавьте фильтр: цена, наличие, бренд или характеристика.' }}
        columns={[
          { key: 'label', header: 'Название', cell: (f) => <Link href={`/admin/catalog/filters/${f.id}`}>{f.label}</Link> },
          { key: 'kind', header: 'Вид', cell: (f) => (f.kind === 'attribute' ? `Характеристика: ${f.attributeName ?? '—'}` : FILTER_KIND_LABELS[f.kind]) },
          { key: 'widget', header: 'Отображение', hideOnNarrow: true, cell: (f) => FILTER_WIDGET_LABELS[f.widget] },
          { key: 'cats', header: 'Категории', hideOnNarrow: true, cell: (f) => (f.categoryIds.length === 0 ? 'Все' : `Выбрано: ${f.categoryIds.length}`) },
          {
            key: 'state',
            header: 'Состояние',
            cell: (f) =>
              !f.enabled ? <StatusBadge tone="neutral">Выключен</StatusBadge> : f.attributeFilterable === false ? <StatusBadge tone="warning">Характеристика вне фильтров</StatusBadge> : <StatusBadge tone="success">Включён</StatusBadge>,
          },
          { key: 'sort', header: 'Порядок', align: 'right', cell: (f) => f.sort },
          {
            key: 'actions',
            header: 'Действия',
            cell: (f) =>
              canWrite ? (
                <span className="ak-inline">
                  <form action={moveFilterAction}>
                    <input type="hidden" name="id" value={f.id} />
                    <button type="submit" name="dir" value="up" className="ak-btn ak-btn--sm ak-btn--outline" aria-label={`Выше: ${f.label}`}>↑</button>
                    <button type="submit" name="dir" value="down" className="ak-btn ak-btn--sm ak-btn--outline" aria-label={`Ниже: ${f.label}`}>↓</button>
                  </form>
                  <form action={toggleFilterAction}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="enabled" value={f.enabled ? '0' : '1'} />
                    <button type="submit" className="ak-btn ak-btn--sm ak-btn--outline">{f.enabled ? 'Выключить' : 'Включить'}</button>
                  </form>
                </span>
              ) : null,
          },
        ]}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={result.total} basePath="/admin/catalog/filters" params={sp} />}
      />
    </>
  );
}
