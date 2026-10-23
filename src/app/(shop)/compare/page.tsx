import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { compare, MAX_COMPARE } from '@/domain/customers/compare';
import { resolveOwner } from '@/domain/customers/session';
import { formatRub } from '@/domain/pricing/format';
import '@/ui/cart/cart.css';
import '@/ui/catalog/catalog.css';
import '@/ui/compare/compare.css';
import { AddToCartButton } from '@/ui/catalog/AddToCartButton';
import { EmptyState } from '@/ui/states';
import { removeCompareAction } from './actions';

export const metadata: Metadata = { title: 'Сравнение товаров', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ diff?: string }> }) {
  const sp = await searchParams;
  const onlyDiff = sp.diff === '1';
  const owner = resolveOwner(await cookies());
  const table = compare.table(owner);

  if (table.products.length === 0) {
    return (
      <div className="compare container">
        <h1>Сравнение товаров</h1>
        <EmptyState title="Сравнивать пока нечего">
          <p>
            Откройте <Link href="/catalog">каталог</Link> и нажмите «Сравнение» у нужных товаров — можно выбрать до {MAX_COMPARE}.
          </p>
        </EmptyState>
      </div>
    );
  }

  const rows = onlyDiff ? table.rows.filter((r) => r.differs) : table.rows;
  const hasDiffs = table.rows.some((r) => r.differs);

  return (
    <div className="compare container">
      <h1>Сравнение товаров</h1>
      <p className="compare__hint">
        Выбрано {table.products.length} из {MAX_COMPARE}. Различия в характеристиках выделены.
        {table.products.length > 1 && table.rows.length > 0 ? (
          <>
            {' '}
            {onlyDiff ? <Link href="/compare">Показать все характеристики</Link> : <Link href="/compare?diff=1">Показать только различия</Link>}
          </>
        ) : null}
      </p>
      {table.products.length === 1 ? <p className="compare__hint">Добавьте ещё товар, чтобы увидеть различия.</p> : null}

      <div className="table-scroll">
        <table className="compare-table">
          <caption className="visually-hidden">Сравнение характеристик товаров</caption>
          <thead>
            <tr>
              <th scope="col"><span className="visually-hidden">Характеристика</span></th>
              {table.products.map((p) => (
                <th scope="col" key={p.id}>
                  <Link href={`/product/${p.slug}`}>{p.name}</Link>
                  {p.sku ? <div className="compare__sku">Артикул: {p.sku}</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Цена</th>
              {table.products.map((p) => (
                <td key={p.id}>
                  {p.originalKopecks ? <span className="price__old">{formatRub(p.originalKopecks)}</span> : null}
                  <span className="price">{formatRub(p.unitKopecks)}</span>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Наличие</th>
              {table.products.map((p) => (
                <td key={p.id}>{p.inStock ? 'В наличии' : 'Нет в наличии'}</td>
              ))}
            </tr>
            {rows.map((r) => (
              <tr key={r.name} className={r.differs ? 'compare-table__row--diff' : undefined}>
                <th scope="row">
                  {r.name}
                  {r.differs ? <span className="visually-hidden"> (значения различаются)</span> : null}
                </th>
                {r.values.map((v, i) => (
                  <td key={table.products[i]!.id}>{v ?? <span className="compare__missing">—<span className="visually-hidden"> нет данных</span></span>}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Действия</th>
              {table.products.map((p) => (
                <td key={p.id}>
                  <div className="compare__actions">
                    <AddToCartButton productId={p.id} inStock={p.inStock} name={p.name} compact />
                    <form action={removeCompareAction}>
                      <input type="hidden" name="productId" value={p.id} />
                      <button type="submit" className="link-button" aria-label={`Убрать из сравнения: ${p.name}`}>
                        Убрать
                      </button>
                    </form>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {onlyDiff && rows.length === 0 && table.rows.length > 0 ? <p>Различий в характеристиках нет.</p> : null}
      {!hasDiffs && table.rows.length > 0 && table.products.length > 1 ? <p className="compare__hint">Все характеристики совпадают.</p> : null}
      {table.rows.length === 0 ? <p className="compare__hint">У выбранных товаров нет характеристик для сравнения.</p> : null}
    </div>
  );
}
