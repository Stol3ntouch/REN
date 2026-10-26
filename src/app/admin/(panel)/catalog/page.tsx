import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { AVAILABILITIES, AVAILABILITY_LABELS, filterToParams, parseProductListQuery } from '@/domain/catalog/products-list';
import { AppError } from '@/server/http/errors';
import { requireStaffPage } from '@/ui/admin/guard';
import { ErrorState, FilterPanel, firstParam, FlashToast, FormField, PageHeader, SearchInput, SelectField, type SearchParams } from '@/ui/admin/kit';
import { productListOps } from '../_lib/product-list-ops';
import { productOps } from '../_lib/product-ops';
import { ProductTable } from './ProductTable';

export const metadata: Metadata = { title: 'Товары' };
export const dynamic = 'force-dynamic';

const can = (session: Parameters<typeof hasPermission>[0], ...perms: Parameters<typeof hasPermission>[1][]) => perms.some((p) => hasPermission(session, p));

export default async function AdminCatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('products.read');
  const sp = await searchParams;
  const query = parseProductListQuery(sp);
  const canWrite = can(session, 'products.write', 'catalog.write');
  const canDelete = can(session, 'products.delete');
  const canExport = can(session, 'export.run');
  const options = productOps.formOptions(session);

  let result = null;
  let error: string | null = null;
  try {
    result = productListOps.list(session, query);
  } catch (e) {
    error = e instanceof AppError ? e.message : 'Не удалось загрузить товары. Обновите страницу.';
  }

  const back = (() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (!['ok', 'error', 'done'].includes(k) && firstParam(v)) p.set(k, firstParam(v));
    const s = p.toString();
    return s ? `/admin/catalog?${s}` : '/admin/catalog';
  })();
  const exportHref = `/admin/api/products/export?${new URLSearchParams(filterToParams(query)).toString()}`;
  const done = firstParam(sp.done);

  return (
    <>
      <FlashToast ok={firstParam(sp.ok)} error={firstParam(sp.error)} okText={done || 'Готово.'} />
      <PageHeader
        title="Товары"
        description={result ? `Найдено: ${result.total}` : undefined}
        actions={
          <>
            {canExport ? (
              <a href={exportHref} className="ak-btn ak-btn--outline" download>
                Экспорт CSV
              </a>
            ) : null}
            {canWrite ? (
              <Link href="/admin/catalog/products/new" className="ak-btn ak-btn--primary">
                Добавить
              </Link>
            ) : null}
          </>
        }
      />
      <div className="ak-toolbar">
        <SearchInput label="Поиск товаров" placeholder="Название, артикул или штрихкод" defaultValue={query.q ?? ''} />
      </div>
      <FilterPanel basePath="/admin/catalog" params={sp} title="Фильтр товаров" preserve={['q', 'sort', 'dir', 'pageSize']}>
        <SelectField name="category" label="Категория (с подкатегориями)" placeholder="Все" defaultValue={String(query.categoryId ?? '')} options={options.categories.map((c) => ({ value: String(c.id), label: c.label }))} />
        <SelectField name="brand" label="Бренд" placeholder="Все" defaultValue={String(query.brandId ?? '')} options={options.brands.map((b) => ({ value: String(b.id), label: b.name }))} />
        <SelectField name="availability" label="Наличие" placeholder="Любое" defaultValue={query.availability ?? ''} options={AVAILABILITIES.map((a) => ({ value: a, label: AVAILABILITY_LABELS[a] }))} />
        <SelectField
          name="published"
          label="Публикация"
          placeholder="Любая"
          defaultValue={query.published === undefined ? '' : query.published ? '1' : '0'}
          options={[
            { value: '1', label: 'Опубликованные' },
            { value: '0', label: 'Не опубликованные' },
          ]}
        />
        <SelectField
          name="hidden"
          label="Скрытие"
          placeholder="Любое"
          defaultValue={query.hidden === undefined ? '' : query.hidden ? '1' : '0'}
          options={[
            { value: '1', label: 'Скрытые с сайта' },
            { value: '0', label: 'Не скрытые' },
          ]}
        />
        <FormField name="priceMin" label="Цена от, ₽" inputMode="decimal" defaultValue={firstParam(sp.priceMin)} />
        <FormField name="priceMax" label="Цена до, ₽" inputMode="decimal" defaultValue={firstParam(sp.priceMax)} />
        <div className="pl-flags" role="group" aria-label="Признаки">
          <label>
            <input type="checkbox" name="new" value="1" defaultChecked={query.isNew === true} /> Новинка
          </label>
          <label>
            <input type="checkbox" name="featured" value="1" defaultChecked={query.featured === true} /> Рекомендуемый
          </label>
          <label>
            <input type="checkbox" name="promo" value="1" defaultChecked={query.isPromo === true} /> Акция
          </label>
        </div>
      </FilterPanel>
      {result ? (
        <ProductTable result={result} query={query} params={sp} canWrite={canWrite} canDelete={canDelete} back={back} options={options} />
      ) : (
        <div className="ak-card">
          <ErrorState title="Не удалось загрузить товары">
            <p>{error}</p>
          </ErrorState>
        </div>
      )}
    </>
  );
}
