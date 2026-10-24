import Link from 'next/link';
import { pluralize } from '@/domain/catalog/format';
import type { CategoryVisibilityRow } from '../category-visibility-ops';
import { setCategoryHiddenAction } from './actions';

/** Окно подтверждения: что произойдёт на сайте. Числа считает categoryVisibilityOps.impact. */
export type VisibilityConfirm = { id: number; name: string; hide: boolean; categories: number; products: number };

function stateLabel(row: CategoryVisibilityRow): string {
  if (row.hidden) return 'скрыта';
  if (row.effectiveHidden) return 'скрыта вместе с родителем';
  return 'показана';
}

function ConfirmBox({ confirm }: { confirm: VisibilityConfirm }) {
  const products = `${confirm.products} ${pluralize(confirm.products, ['товар', 'товара', 'товаров'])}`;
  const categories = `${confirm.categories} ${pluralize(confirm.categories, ['категория', 'категории', 'категорий'])}`;
  return (
    <form action={setCategoryHiddenAction} className="adm-card" aria-label="Подтверждение" role="alertdialog" aria-labelledby="cat-confirm-title">
      <input type="hidden" name="id" value={confirm.id} />
      <input type="hidden" name="hidden" value={confirm.hide ? '1' : '0'} />
      <h2 id="cat-confirm-title">
        {confirm.hide ? 'Скрыть' : 'Показать'} категорию «{confirm.name}»?
      </h2>
      <p>
        {confirm.hide ? 'С сайта пропадут' : 'На сайте появятся'}: {categories} (с самой категорией), {products}.
        {confirm.hide ? ' Ничего не удаляется: категорию можно вернуть кнопкой «Показать». Прошлые заказы не меняются.' : ''}
      </p>
      <div className="adm-inline">
        <button type="submit" className="button">
          Подтвердить
        </button>
        <Link className="button button--outline" href="/admin/catalog/categories">
          Отмена
        </Link>
      </div>
    </form>
  );
}

/**
 * Таблица категорий с состоянием на сайте. Кнопки «Скрыть»/«Показать» — только при canWrite (catalog.write):
 * у менеджера таблица только для чтения. Кнопка ведёт на подтверждение (?confirm=hide:<id>), само действие — POST-форма.
 */
export function CategoryVisibilityTable({ rows, canWrite, confirm }: { rows: CategoryVisibilityRow[]; canWrite: boolean; confirm?: VisibilityConfirm | null }) {
  return (
    <>
      {canWrite && confirm ? <ConfirmBox confirm={confirm} /> : null}
      <div className="adm-table-wrap">
        <table className="adm-table">
          <caption className="visually-hidden">Категории каталога</caption>
          <thead>
            <tr>
              <th scope="col">Категория</th>
              <th scope="col">Адрес</th>
              <th scope="col" className="num">
                Товаров
              </th>
              <th scope="col">SEO-текст</th>
              <th scope="col">На сайте</th>
              {canWrite ? (
                <th scope="col">
                  <span className="visually-hidden">Действие</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} data-hidden={c.effectiveHidden ? '1' : undefined}>
                <td style={{ paddingLeft: `${12 + c.depth * 20}px` }}>
                  <Link href={`/admin/catalog/categories/${c.id}`}>{c.name}</Link>
                </td>
                <td>/catalog/{c.slug}</td>
                <td className="num">{c.productCount}</td>
                <td>{c.hasSeoText ? 'заполнен' : 'не заполнен'}</td>
                <td>{c.effectiveHidden ? <strong>{stateLabel(c)}</strong> : stateLabel(c)}</td>
                {canWrite ? (
                  <td>
                    <Link className="button button--outline" href={`/admin/catalog/categories?confirm=${c.hidden ? 'show' : 'hide'}:${c.id}`}>
                      {c.hidden ? 'Показать' : 'Скрыть'}
                    </Link>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
