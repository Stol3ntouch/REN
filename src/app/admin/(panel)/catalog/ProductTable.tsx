import Link from 'next/link';
import { AVAILABILITY_LABELS, type ProductListItem, type ProductListQuery, type ProductListResult } from '@/domain/catalog/products-list';
import { formatRub } from '@/domain/pricing/format';
import { DataTable, Pagination, StatusBadge, Toggle, ConfirmButton, type SearchParams, type StatusTone } from '@/ui/admin/kit';
import { BulkPanel, type PanelOptions } from './products/list/BulkPanel';
import { bulkProductsAction, deleteProductAction, duplicateProductAction, togglePublishedAction } from './products/list/actions';
import './products/list/product-list.css';

/** Статус на сайте: скрытый администратором помечается отдельно от снятого с публикации. */
export function visibilityLabel(p: Pick<ProductListItem, 'hidden' | 'published'>): string {
  return p.hidden ? 'скрыт' : p.published ? 'опубликован' : 'снят с публикации';
}

const AVAILABILITY_TONE: Record<ProductListItem['availability'], StatusTone> = { in_stock: 'success', preorder: 'info', out_of_stock: 'warning', discontinued: 'neutral' };

const dateText = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
};

export const PRODUCT_TABLE_PATH = '/admin/catalog';

/**
 * Таблица товаров. Кнопки изменения (переключатель публикации, дублирование, массовые действия) — только canWrite (products.write),
 * удаление — canDelete (products.delete): без прав таблица только для чтения и без чекбоксов. Закупочной цены нет.
 */
export function ProductTable({
  result,
  query,
  params,
  canWrite,
  canDelete,
  back,
  options,
  basePath = PRODUCT_TABLE_PATH,
}: {
  result: ProductListResult;
  query: Pick<ProductListQuery, 'sort' | 'dir'>;
  params: SearchParams;
  canWrite: boolean;
  canDelete: boolean;
  back: string;
  options: PanelOptions;
  /** Адрес страницы со списком (по умолчанию «Товары»; вкладка «Товары» категории передаёт свой). */
  basePath?: string;
}) {
  const bulk = canWrite || canDelete;
  const rowForm = (id: number) => (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  return (
    <DataTable<ProductListItem>
      caption="Товары"
      basePath={basePath}
      params={params}
      sort={query.sort}
      dir={query.dir}
      rows={result.items}
      rowKey={(p) => p.id}
      selectable={bulk}
      bulkFormId="pl-bulk"
      rowLabel={(p) => `Выбрать «${p.name}»`}
      bulkActions={bulk ? <BulkPanel formId="pl-bulk" canWrite={canWrite} canDelete={canDelete} total={result.total} back={back} params={params} options={options} bulkAction={bulkProductsAction} /> : undefined}
      empty={{ title: 'Товаров не найдено', description: 'Измените условия поиска и фильтры или загрузите каталог в разделе «Импорт».' }}
      columns={[
        {
          key: 'photo',
          header: 'Фото',
          width: '64px',
          cell: (p) => (
            <span className="pl-thumb">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image.src} alt="" width={48} height={48} loading="lazy" decoding="async" />
              ) : (
                <span aria-label="Нет фото">—</span>
              )}
            </span>
          ),
        },
        {
          key: 'name',
          header: 'Наименование',
          sortKey: 'name',
          cell: (p) => (
            <span className="pl-name">
              <Link href={`/admin/catalog/${p.id}`}>{p.name}</Link>
              {p.shortDescription ? <small title={p.shortDescription}>{p.shortDescription}</small> : null}
            </span>
          ),
        },
        { key: 'sku', header: 'Артикул', hideOnNarrow: true, cell: (p) => p.sku ?? '—' },
        { key: 'category', header: 'Категория', sortKey: 'category', hideOnNarrow: true, cell: (p) => p.categoryName },
        {
          key: 'price',
          header: 'Цена',
          sortKey: 'price',
          align: 'right',
          cell: (p) => {
            const sale = p.discountPriceKopecks !== null && p.discountPriceKopecks < p.priceKopecks;
            const old = sale ? p.priceKopecks : p.oldPriceKopecks !== null && p.oldPriceKopecks > p.priceKopecks ? p.oldPriceKopecks : null;
            return (
              <span className="pl-price">
                {formatRub(sale ? (p.discountPriceKopecks as number) : p.priceKopecks)}
                {old !== null ? <s>{formatRub(old)}</s> : null}
              </span>
            );
          },
        },
        { key: 'stock', header: 'Остаток', sortKey: 'stock', align: 'right', hideOnNarrow: true, cell: (p) => (p.stockTracked ? p.stockQty : '—') },
        { key: 'availability', header: 'Наличие', cell: (p) => <StatusBadge tone={AVAILABILITY_TONE[p.availability]}>{AVAILABILITY_LABELS[p.availability]}</StatusBadge> },
        {
          key: 'status',
          header: 'Публикация',
          cell: (p) => (
            <span>
              {canWrite ? <Toggle checked={p.published} label={`Опубликован: ${p.name}`} hideLabel action={togglePublishedAction.bind(null, p.id)} /> : <StatusBadge tone={p.published ? 'success' : 'warning'}>{p.published ? 'Опубликован' : 'Не опубликован'}</StatusBadge>}
              {p.hidden ? (
                <>
                  {' '}
                  <StatusBadge tone="neutral">Скрыт</StatusBadge>
                </>
              ) : null}
            </span>
          ),
        },
        { key: 'date', header: 'Дата', sortKey: 'date', hideOnNarrow: true, cell: (p) => dateText(p.updatedAt) },
        {
          key: 'actions',
          header: <span className="visually-hidden">Действия</span>,
          cell: (p) => (
            <span className="pl-actions">
              <Link href={`/admin/catalog/${p.id}`} className="ak-btn ak-btn--sm ak-btn--outline">
                {canWrite ? 'Изменить' : 'Открыть'}
              </Link>
              {canWrite || canDelete ? (
                <details className="pl-more">
                  <summary className="ak-btn ak-btn--sm ak-btn--outline" aria-label={`Ещё: ${p.name}`}>
                    Ещё
                  </summary>
                  <div className="pl-more__menu">
                    {canWrite ? (
                      <form action={duplicateProductAction}>
                        {rowForm(p.id)}
                        <button type="submit" className="ak-btn ak-btn--sm ak-btn--outline">
                          Дублировать
                        </button>
                      </form>
                    ) : null}
                    {canDelete ? (
                      <form action={deleteProductAction}>
                        {rowForm(p.id)}
                        <ConfirmButton title={`Удалить «${p.name}»?`} description="Товар будет удалён вместе с фото и характеристиками. Если он есть в заказах, удаление недоступно — скройте его." confirmLabel="Удалить" className="ak-btn ak-btn--sm ak-btn--danger-outline">
                          Удалить
                        </ConfirmButton>
                      </form>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </span>
          ),
        },
      ]}
      footer={<Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath={basePath} params={params} />}
    />
  );
}
