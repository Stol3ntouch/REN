import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { getDb } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { requireStaffPage } from '@/ui/admin/guard';
import { ConfirmButton, FlashToast, PageHeader, type SearchParams } from '@/ui/admin/kit';
import { filterOps } from '../../../_lib/filters-ops';
import { FilterForm } from '../FilterForm';
import { deleteFilterAction } from '../actions';

export const metadata: Metadata = { title: 'Фильтр' };
export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function FilterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('catalog.read');
  const id = Number((await params).id);
  const sp = await searchParams;
  const filter = Number.isInteger(id) && id > 0 ? filterOps.get(session, id) : null;
  if (!filter) notFound();
  const canWrite = hasPermission(session.role, 'catalog.write');
  const db = getDb();
  return (
    <>
      <FlashToast ok={one(sp.ok)} error={one(sp.error)} />
      <PageHeader title={filter.label} />
      {canWrite ? (
        <>
          <FilterForm filter={filter} attributes={attributesRepo.listAll(db).filter((a) => a.filterable || a.id === filter.attributeId)} categories={categoriesRepo.listAll(db)} />
          <section className="ak-card" aria-labelledby="filter-del">
            <h2 id="filter-del">Удаление</h2>
            <form action={deleteFilterAction}>
              <input type="hidden" name="id" value={id} />
              <ConfirmButton title={`Удалить фильтр «${filter.label}»?`} description="Фильтр пропадёт с сайта. Сами данные товаров не затрагиваются." confirmLabel="Удалить">
                Удалить фильтр
              </ConfirmButton>
            </form>
          </section>
        </>
      ) : (
        <p className="ak-muted">Просмотр: редактирование доступно администратору.</p>
      )}
    </>
  );
}
