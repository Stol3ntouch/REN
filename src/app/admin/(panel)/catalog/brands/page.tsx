import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { MEDIA_BASE } from '@/domain/catalog/images';
import type { BrandListRow } from '@/server/db/repositories/brands';
import { requireStaffPage } from '@/ui/admin/guard';
import { DataTable, FilterPanel, FlashToast, ImagePreview, PageHeader, Pagination, parseListParams, SearchInput, SelectField, StatusBadge, type SearchParams } from '@/ui/admin/kit';
import { brandOps } from '../../_lib/brands-ops';

export const metadata: Metadata = { title: 'Бренды' };
export const dynamic = 'force-dynamic';

const SORTS = ['name', 'sort', 'products', 'created'] as const;
const STATUSES = ['active', 'published', 'hidden', 'archived', 'all'] as const;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function BrandsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  const list = parseListParams(sp, { sorts: SORTS, defaultSort: 'sort' });
  const statusRaw = first(sp.status);
  const status = (STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as (typeof STATUSES)[number]) : 'active';
  const result = brandOps.list(session, { q: list.q || undefined, status, sort: list.sort as (typeof SORTS)[number], dir: list.dir, limit: list.pageSize, offset: (list.page - 1) * list.pageSize });
  const canWrite = hasPermission(session.role, 'catalog.write');

  return (
    <>
      <FlashToast ok={first(sp.ok)} error={first(sp.error)} okText="Готово." />
      <PageHeader
        title="Бренды"
        description="Производители товаров: логотип, SEO и привязанные товары. Бренд участвует в фильтре каталога."
        actions={canWrite ? <Link href="/admin/catalog/brands/new" className="ak-btn ak-btn--primary">Добавить бренд</Link> : undefined}
      />
      <div className="ak-toolbar">
        <SearchInput label="Поиск брендов" placeholder="Название или slug" defaultValue={list.q} />
      </div>
      <FilterPanel basePath="/admin/catalog/brands" params={sp} title="Фильтр брендов">
        <SelectField
          name="status"
          label="Статус"
          defaultValue={status}
          options={[
            { value: 'active', label: 'Не в архиве' },
            { value: 'published', label: 'Опубликованные' },
            { value: 'hidden', label: 'Скрытые' },
            { value: 'archived', label: 'В архиве' },
            { value: 'all', label: 'Все' },
          ]}
        />
      </FilterPanel>
      <DataTable<BrandListRow>
        caption="Бренды"
        basePath="/admin/catalog/brands"
        params={sp}
        sort={list.sort}
        dir={list.dir}
        rows={result.rows}
        rowKey={(b) => b.id}
        empty={{ title: 'Брендов пока нет', description: 'Бренд появится при импорте, если в файле указан производитель, либо добавьте его вручную.' }}
        columns={[
          { key: 'logo', header: 'Логотип', width: '72px', cell: (b) => (b.logoPath ? <ImagePreview src={`${MEDIA_BASE}/${encodeURIComponent(b.logoPath)}`} alt={`Логотип ${b.name}`} width={48} height={48} fit="contain" /> : <span className="ak-muted">—</span>) },
          { key: 'name', header: 'Название', sortKey: 'name', cell: (b) => <Link href={`/admin/catalog/brands/${b.id}`}>{b.name}</Link> },
          { key: 'slug', header: 'Slug', hideOnNarrow: true, cell: (b) => b.slug },
          { key: 'products', header: 'Товаров', sortKey: 'products', align: 'right', cell: (b) => (b.productCount > 0 ? <Link href={`/admin/catalog?brand=${b.id}`}>{b.productCount}</Link> : 0) },
          { key: 'sort', header: 'Позиция', sortKey: 'sort', align: 'right', hideOnNarrow: true, cell: (b) => b.sort },
          { key: 'status', header: 'Статус', cell: (b) => (b.archived ? <StatusBadge tone="neutral">В архиве</StatusBadge> : b.published ? <StatusBadge tone="success">Опубликован</StatusBadge> : <StatusBadge tone="warning">Скрыт</StatusBadge>) },
        ]}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={result.total} basePath="/admin/catalog/brands" params={sp} />}
      />
    </>
  );
}
