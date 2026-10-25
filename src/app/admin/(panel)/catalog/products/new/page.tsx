import type { Metadata } from 'next';
import { requireStaffPage } from '@/ui/admin/guard';
import { FlashToast, PageHeader, type SearchParams } from '@/ui/admin/kit';
import { canViewCost, productOps } from '../../../_lib/product-ops';
import { ProductFormView } from '../ProductForm';

export const metadata: Metadata = { title: 'Новый товар' };
export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function NewProductPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('products.write');
  const sp = await searchParams;
  return (
    <>
      <FlashToast ok={one(sp.ok)} error={one(sp.error)} />
      <PageHeader title="Новый товар" />
      <ProductFormView product={null} options={productOps.formOptions(session)} canWrite canCost={canViewCost(session)} canDelete={false} history={[]} />
    </>
  );
}
