import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { requireStaffPage } from '@/ui/admin/guard';
import { FlashToast, PageHeader, StatusBadge, type SearchParams } from '@/ui/admin/kit';
import { canViewCost, productOps } from '../../_lib/product-ops';
import { stockOps } from '../../_lib/stock-ops';
import { ProductFormView } from '../products/ProductForm';

export const metadata: Metadata = { title: 'Карточка товара' };
export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('products.read');
  const { id: rawId } = await params;
  const sp = await searchParams;
  const id = Number(rawId);
  const product = Number.isInteger(id) && id > 0 ? productOps.get(session, id) : null;
  if (!product) notFound();

  const canWrite = hasPermission(session, 'products.write') || hasPermission(session, 'catalog.write');
  return (
    <>
      <FlashToast ok={one(sp.ok)} error={one(sp.error)} />
      <PageHeader
        title={product.name}
        description={
          <>
            {product.hidden ? <StatusBadge tone="neutral">Скрыт</StatusBadge> : product.published ? <StatusBadge tone="success">Опубликован</StatusBadge> : <StatusBadge tone="warning">Не опубликован</StatusBadge>}{' '}
            {product.hidden ? null : <a href={`/product/${product.slug}`}>Открыть на сайте</a>}
          </>
        }
      />
      <ProductFormView
        product={product}
        options={productOps.formOptions(session)}
        canWrite={canWrite}
        canCost={canViewCost(session)}
        canDelete={hasPermission(session, 'products.delete')}
        history={stockOps.history(session, id)}
      />
    </>
  );
}
