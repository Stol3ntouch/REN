import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { CATALOG_NAV, SubNav } from '../../_lib/ui';
import { categorySeoOps } from '../category-seo-ops';

export const metadata: Metadata = { title: 'Категории и SEO' };
export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  const session = await requireStaffPage('catalog.read');
  const rows = categorySeoOps.list(session);
  return (
    <>
      <h1>Категории и SEO</h1>
      <SubNav items={CATALOG_NAV} current="/admin/catalog/categories" />
      <p className="ops-muted">Title, description, H1 и SEO-текст категорий. Текст выводится под сеткой товаров на странице категории; пока он пуст, блока на сайте нет.</p>
      {rows.length === 0 ? (
        <EmptyState title="Категорий пока нет">
          <p>Они появятся после импорта каталога в разделе «Импорт».</p>
        </EmptyState>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Категории</caption>
            <thead>
              <tr>
                <th scope="col">Категория</th>
                <th scope="col">Адрес</th>
                <th scope="col">SEO-текст</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ paddingLeft: `${12 + c.depth * 20}px` }}>
                    <Link href={`/admin/catalog/categories/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>/catalog/{c.slug}</td>
                  <td>{c.hasSeoText ? 'заполнен' : 'не заполнен'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
