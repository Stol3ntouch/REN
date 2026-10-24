import type { Metadata } from 'next';
import { hasPermission } from '@/domain/admin/permissions';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { CATALOG_NAV, Flash, str, SubNav } from '../../_lib/ui';
import { categoryVisibilityOps } from '../category-visibility-ops';
import { CategoryVisibilityTable, type VisibilityConfirm } from './CategoryVisibilityTable';

export const metadata: Metadata = { title: 'Категории и SEO' };
export const dynamic = 'force-dynamic';

/** ?confirm=hide:<id> | show:<id> → данные окна подтверждения (число затрагиваемых категорий и товаров). */
function parseConfirm(raw: string | undefined, session: Parameters<typeof categoryVisibilityOps.impact>[0], rows: { id: number; name: string }[]): VisibilityConfirm | null {
  const m = /^(hide|show):(\d+)$/.exec(raw ?? '');
  if (!m) return null;
  const id = Number(m[2]);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const hide = m[1] === 'hide';
  return { id, name: row.name, hide, ...categoryVisibilityOps.impact(session, id, hide) };
}

export default async function AdminCategoriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  const canWrite = hasPermission(session, 'catalog.write');
  const rows = categoryVisibilityOps.list(session);
  const confirm = canWrite ? parseConfirm(str(sp.confirm), session, rows) : null;
  return (
    <>
      <h1>Категории и SEO</h1>
      <SubNav items={CATALOG_NAV} current="/admin/catalog/categories" />
      <p className="ops-muted">
        Title, description, H1 и SEO-текст категорий. Текст выводится под сеткой товаров на странице категории; пока он пуст, блока на сайте нет.
        Скрытая категория вместе с подкатегориями и товарами пропадает с сайта (адрес даёт 404), но не удаляется — её можно вернуть кнопкой «Показать».
      </p>
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Готово." />
      {rows.length === 0 ? (
        <EmptyState title="Категорий пока нет">
          <p>Они появятся после импорта каталога в разделе «Импорт».</p>
        </EmptyState>
      ) : (
        <CategoryVisibilityTable rows={rows} canWrite={canWrite} confirm={confirm} />
      )}
    </>
  );
}
