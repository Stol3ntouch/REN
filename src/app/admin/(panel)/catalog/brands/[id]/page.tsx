import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { requireStaffPage } from '@/ui/admin/guard';
import { ConfirmButton, DataTable, FlashToast, PageHeader, Pagination, parseListParams, SelectField, StatusBadge, type SearchParams } from '@/ui/admin/kit';
import { brandOps } from '../../../_lib/brands-ops';
import { BrandForm } from '../BrandForm';
import { archiveBrandAction, attachProductsAction, deleteBrandAction, detachProductsAction } from '../actions';

export const metadata: Metadata = { title: 'Бренд' };
export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function BrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('catalog.read');
  const id = Number((await params).id);
  const sp = await searchParams;
  const brand = Number.isInteger(id) && id > 0 ? brandOps.get(session, id) : null;
  if (!brand) notFound();

  const canWrite = hasPermission(session.role, 'catalog.write');
  const list = parseListParams(sp, { defaultPageSize: 20 });
  const products = brandOps.products(session, id, { limit: list.pageSize, offset: (list.page - 1) * list.pageSize });
  const found = canWrite ? brandOps.searchProductsToAttach(session, id, one(sp.find)) : [];
  const others = canWrite ? brandOps.options(session).filter((b) => b.id !== id) : [];
  const here = `/admin/catalog/brands/${id}`;

  return (
    <>
      <FlashToast ok={one(sp.ok)} error={one(sp.error)} />
      <PageHeader
        title={brand.name}
        description={
          <>
            {brand.archived ? <StatusBadge tone="neutral">В архиве</StatusBadge> : brand.published ? <StatusBadge tone="success">Опубликован</StatusBadge> : <StatusBadge tone="warning">Скрыт</StatusBadge>}{' '}
            Привязано товаров: <Link href={`/admin/catalog?brand=${id}`}>{brand.productCount}</Link>
          </>
        }
      />
      {canWrite ? <BrandForm brand={brand} /> : <p className="ak-muted">Просмотр: редактирование доступно администратору.</p>}

      <section className="ak-card" aria-labelledby="brand-products">
        <h2 id="brand-products">Привязанные товары</h2>
        <form id="detach-form" action={detachProductsAction}>
          <input type="hidden" name="id" value={id} />
        </form>
        <DataTable
          caption="Товары бренда"
          basePath={here}
          params={sp}
          rows={products.rows}
          rowKey={(p) => p.id}
          selectable={canWrite}
          bulkFormId="detach-form"
          bulkActions={<ConfirmButton form="detach-form" title="Отвязать выбранные товары?" confirmLabel="Отвязать">Отвязать выбранные</ConfirmButton>}
          rowLabel={(p) => `Выбрать ${p.name}`}
          empty={{ title: 'Товаров нет', description: 'Найдите товары по названию или артикулу ниже и привяжите их к бренду.' }}
          columns={[
            { key: 'name', header: 'Товар', cell: (p) => <Link href={`/admin/catalog/${p.id}`}>{p.name}</Link> },
            { key: 'sku', header: 'Артикул', cell: (p) => p.sku ?? '—' },
            { key: 'status', header: 'Статус', cell: (p) => (p.published ? <StatusBadge tone="success">Опубликован</StatusBadge> : <StatusBadge tone="warning">Скрыт</StatusBadge>) },
          ]}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={products.total} basePath={here} params={sp} />}
        />
      </section>

      {canWrite ? (
        <section className="ak-card" aria-labelledby="brand-attach">
          <h2 id="brand-attach">Добавить товары</h2>
          <form method="get" action={here} role="search" className="ak-inline">
            <label className="ak-field__label" htmlFor="find">Название или артикул (от 2 символов)</label>
            <input id="find" name="find" type="search" defaultValue={one(sp.find)} maxLength={100} />
            <button type="submit" className="ak-btn ak-btn--outline">Найти</button>
          </form>
          {found.length > 0 ? (
            <form action={attachProductsAction}>
              <input type="hidden" name="id" value={id} />
              <ul className="ak-list">
                {found.map((p) => (
                  <li key={p.id}>
                    <label>
                      <input type="checkbox" name="ids" value={p.id} /> {p.name} {p.sku ? `(${p.sku})` : ''}
                      {p.brandName ? <span className="ak-muted"> — сейчас бренд «{p.brandName}»</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
              <button type="submit" className="ak-btn ak-btn--primary">Привязать выбранные</button>
            </form>
          ) : one(sp.find).trim().length >= 2 ? (
            <p className="ak-muted">Ничего не найдено.</p>
          ) : null}
        </section>
      ) : null}

      {canWrite ? (
        <section className="ak-card" aria-labelledby="brand-danger">
          <h2 id="brand-danger">Архив и удаление</h2>
          <form action={archiveBrandAction} className="ak-inline">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="archived" value={brand.archived ? '0' : '1'} />
            <button type="submit" className="ak-btn ak-btn--outline">{brand.archived ? 'Вернуть из архива' : 'В архив'}</button>
          </form>
          {brand.productCount > 0 ? (
            <p>
              Удалить бренд нельзя, пока к нему привязаны товары ({brand.productCount}). Заархивируйте бренд или перенесите товары в другой.
            </p>
          ) : null}
          <form action={deleteBrandAction} className="ak-form-grid">
            <input type="hidden" name="id" value={id} />
            {brand.productCount > 0 ? <SelectField name="moveTo" label="Перенести товары в бренд" placeholder="Выберите бренд" options={others.map((b) => ({ value: String(b.id), label: b.name, disabled: b.archived }))} required /> : null}
            <ConfirmButton title={`Удалить бренд «${brand.name}»?`} description={brand.productCount > 0 ? 'Товары будут перенесены в выбранный бренд.' : 'Действие нельзя отменить.'} confirmLabel="Удалить">
              {brand.productCount > 0 ? 'Перенести товары и удалить' : 'Удалить бренд'}
            </ConfirmButton>
          </form>
        </section>
      ) : null}
    </>
  );
}
