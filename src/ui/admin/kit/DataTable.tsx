import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Icon } from './icons';
import { SelectionScope } from './SelectionScope';
import { buildHref, type SearchParams, type SortDir } from './url';

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Ключ сортировки в ?sort=; без него колонка не сортируется. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  /** Ширина колонки (CSS). */
  width?: string;
  /** Скрыть колонку на узком экране (остальные остаются, таблица прокручивается). */
  hideOnNarrow?: boolean;
};

export type DataTableProps<T> = {
  /** Название таблицы для скринридера (не показывается). */
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string | number;
  /** Адрес страницы и её параметры — на них строятся ссылки сортировки. */
  basePath: string;
  params?: SearchParams;
  sort?: string | null;
  dir?: SortDir;
  /** Чекбоксы строк. Выбранные id уходят в форму `bulkFormId` полем `selectName` (по умолчанию ids). */
  selectable?: boolean;
  selectName?: string;
  bulkFormId?: string;
  /** Панель массовых действий (форма с id=bulkFormId и кнопками); видна, когда выбрана хотя бы одна строка. */
  bulkActions?: ReactNode;
  rowLabel?: (row: T) => string;
  loading?: boolean;
  /** Текст ошибки загрузки (без внутренних деталей). */
  error?: string | null;
  /** Пустое состояние: заголовок, пояснение и действие. */
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  /** Под таблицей: обычно <Pagination/>. */
  footer?: ReactNode;
};

const SKELETON_ROWS = 5;

/**
 * Таблица данных: сортировка и страница — через адрес (серверная, ссылки работают без JS), компактные строки,
 * чекбоксы и массовая панель, состояния loading / empty / error. Строки приходят с сервера уже отсортированными.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  basePath,
  params = {},
  sort = null,
  dir = 'asc',
  selectable = false,
  selectName = 'ids',
  bulkFormId,
  bulkActions,
  rowLabel,
  loading = false,
  error = null,
  empty = { title: 'Ничего не найдено' },
  footer,
}: DataTableProps<T>) {
  if (error) {
    return (
      <div className="ak-card">
        <ErrorState title="Не удалось загрузить данные">
          <p>{error}</p>
        </ErrorState>
      </div>
    );
  }
  if (!loading && rows.length === 0) {
    return (
      <div className="ak-card">
        <EmptyState title={empty.title} action={empty.action}>
          {empty.description}
        </EmptyState>
        {footer}
      </div>
    );
  }

  const colCount = columns.length + (selectable ? 1 : 0);
  const table = (
    <div className="ak-tablewrap" aria-busy={loading || undefined}>
      <table className="ak-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {selectable ? (
              <th scope="col" className="ak-table__check">
                <input type="checkbox" data-ak-all aria-label="Выбрать все строки на странице" disabled={loading} />
              </th>
            ) : null}
            {columns.map((c) => {
              const sorted = c.sortKey !== undefined && sort === c.sortKey;
              const nextDir: SortDir = sorted && dir === 'asc' ? 'desc' : 'asc';
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`${c.align ? `ak-align-${c.align}` : ''}${c.hideOnNarrow ? ' ak-hide-narrow' : ''}`.trim() || undefined}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={c.sortKey === undefined ? undefined : sorted ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {c.sortKey === undefined ? (
                    c.header
                  ) : (
                    <Link href={buildHref(basePath, params, { sort: c.sortKey, dir: nextDir, page: null })} className="ak-sortlink" prefetch={false} scroll={false}>
                      {c.header}
                      <Icon name={sorted ? (dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrows-vertical'} size={14} />
                      <span className="visually-hidden">{sorted ? `, отсортировано ${dir === 'asc' ? 'по возрастанию' : 'по убыванию'}` : ', сортировать'}</span>
                    </Link>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <tr key={`sk-${i}`} aria-hidden="true">
                  <td colSpan={colCount}>
                    <span className="ak-skeleton" />
                  </td>
                </tr>
              ))
            : rows.map((row) => {
                const id = String(rowKey(row));
                return (
                  <tr key={id}>
                    {selectable ? (
                      <td className="ak-table__check">
                        <input type="checkbox" data-ak-row name={selectName} value={id} {...(bulkFormId ? { form: bulkFormId } : {})} aria-label={rowLabel ? rowLabel(row) : `Выбрать строку ${id}`} />
                      </td>
                    ) : null}
                    {columns.map((c) => (
                      <td key={c.key} className={`${c.align ? `ak-align-${c.align}` : ''}${c.hideOnNarrow ? ' ak-hide-narrow' : ''}`.trim() || undefined}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {loading ? (
        <p className="visually-hidden" role="status">
          Загрузка данных…
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="ak-card ak-card--flush">
      {selectable ? <SelectionScope bulk={bulkActions}>{table}</SelectionScope> : table}
      {footer}
    </div>
  );
}
