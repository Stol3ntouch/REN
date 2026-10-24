import type { Metadata } from 'next';
import { getDb } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { requireStaffPage } from '@/ui/admin/guard';
import { FlashToast, PageHeader, type SearchParams } from '@/ui/admin/kit';
import { FilterForm } from '../FilterForm';

export const metadata: Metadata = { title: 'Новый фильтр' };
export const dynamic = 'force-dynamic';

export default async function NewFilterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaffPage('catalog.write');
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const db = getDb();
  return (
    <>
      <FlashToast ok={one(sp.ok)} error={one(sp.error)} />
      <PageHeader title="Новый фильтр" />
      <FilterForm filter={null} attributes={attributesRepo.listAll(db).filter((a) => a.filterable)} categories={categoriesRepo.listAll(db)} />
    </>
  );
}
