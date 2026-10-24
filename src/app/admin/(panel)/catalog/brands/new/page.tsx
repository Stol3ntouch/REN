import type { Metadata } from 'next';
import { requireStaffPage } from '@/ui/admin/guard';
import { FlashToast, PageHeader, type SearchParams } from '@/ui/admin/kit';
import { BrandForm } from '../BrandForm';

export const metadata: Metadata = { title: 'Новый бренд' };
export const dynamic = 'force-dynamic';

export default async function NewBrandPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaffPage('catalog.write');
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <>
      <FlashToast ok={one(sp.ok)} error={one(sp.error)} />
      <PageHeader title="Новый бренд" />
      <BrandForm brand={null} />
    </>
  );
}
