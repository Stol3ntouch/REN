import type { Metadata } from 'next';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { getDb } from '@/server/db/connection';
import { requireStaffPage } from '@/ui/admin/guard';
import { FlashToast, PageHeader, type SearchParams } from '@/ui/admin/kit';
import { AttributeForm } from '../AttributeForm';

export const metadata: Metadata = { title: 'Новая характеристика' };
export const dynamic = 'force-dynamic';

export default async function NewAttributePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaffPage('catalog.write');
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <>
      <FlashToast ok={one(sp.ok)} error={one(sp.error)} />
      <PageHeader title="Новая характеристика" />
      <AttributeForm attribute={null} categories={categoriesRepo.listAll(getDb())} />
    </>
  );
}
