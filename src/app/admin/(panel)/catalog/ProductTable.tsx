import Link from 'next/link';
import { formatRub } from '@/domain/pricing/format';
import type { AdminProductRow } from '@/server/db/repositories/catalog-admin';
import { MAX_VISIBILITY_BATCH } from '../_lib/catalog-ops';
import { hideProductsAction, showProductsAction } from './actions';

/** Статус на сайте: скрытый администратором помечается отдельно от снятого с публикации. */
export function visibilityLabel(p: Pick<AdminProductRow, 'hidden' | 'published'>): string {
  return p.hidden ? 'скрыт' : p.published ? 'опубликован' : 'снят с публикации';
}

/**
 * Таблица товаров админки. Скрытие/показ (флажки, кнопки в строках, «выбранные») — только при canWrite (catalog.write):
 * у менеджера таблица только для чтения. Строчные кнопки шлют один id (`one`), групповые — отмеченные флажки (`ids`).
 */
export function ProductTable({ rows, canWrite, back }: { rows: AdminProductRow[]; canWrite: boolean; back?: string }) {
  const table = (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <caption className="visually-hidden">Товары</caption>
        <thead>
          <tr>
            {canWrite ? (
              <th scope="col">
                <span className="visually-hidden">Выбрать</span>
              </th>
            ) : null}
            <th scope="col">Название</th>
            <th scope="col">Артикул</th>
            <th scope="col">Категория</th>
            <th scope="col" className="num">
              Цена
            </th>
            <th scope="col">Наличие</th>
            <th scope="col">Публикация</th>
            {canWrite ? (
              <th scope="col">
                <span className="visually-hidden">Действие</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} data-hidden={p.hidden ? '1' : undefined}>
              {canWrite ? (
                <td>
                  <input type="checkbox" name="ids" value={p.id} aria-label={`Выбрать «${p.name}»`} />
                </td>
              ) : null}
              <td>
                <Link href={`/admin/catalog/${p.id}`}>{p.name}</Link>
              </td>
              <td>{p.sku ?? '—'}</td>
              <td>{p.categoryName}</td>
              <td className="num">
                {p.discountPriceKopecks !== null && p.discountPriceKopecks < p.priceKopecks ? (
                  <>
                    {formatRub(p.discountPriceKopecks)} <s className="ops-muted">{formatRub(p.priceKopecks)}</s>
                  </>
                ) : (
                  formatRub(p.priceKopecks)
                )}
              </td>
              <td>{p.inStock ? 'в наличии' : 'нет в наличии'}</td>
              <td>{p.hidden ? <strong>{visibilityLabel(p)}</strong> : visibilityLabel(p)}</td>
              {canWrite ? (
                <td>
                  <button type="submit" name="one" value={p.id} formAction={p.hidden ? showProductsAction : hideProductsAction} className="button button--outline">
                    {p.hidden ? 'Показать' : 'Скрыть'}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (!canWrite) return table;
  return (
    <form aria-label="Товары: скрытие и показ на сайте">
      {back ? <input type="hidden" name="back" value={back} /> : null}
      {table}
      <div className="adm-inline">
        <button type="submit" formAction={hideProductsAction} className="button">
          Скрыть выбранные
        </button>
        <button type="submit" formAction={showProductsAction} className="button button--outline">
          Показать выбранные
        </button>
      </div>
      <p className="ops-muted">За один раз — не больше {MAX_VISIBILITY_BATCH} товаров. Скрытый товар не удаляется: он пропадает с сайта и возвращается кнопкой «Показать».</p>
    </form>
  );
}
