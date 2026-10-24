import type { Metadata } from 'next';
import Link from 'next/link';
import { reviewsModeration } from '@/domain/content/reviews-admin';
import type { ReviewRow, ReviewStatus } from '@/server/db/repositories/reviews';
import { requireStaffPage } from '@/ui/admin/guard';
import { DataTable, type DataTableColumn } from '@/ui/admin/kit/DataTable';
import { FilterPanel } from '@/ui/admin/kit/FilterPanel';
import { FormField } from '@/ui/admin/kit/FormField';
import { PageHeader } from '@/ui/admin/kit/PageHeader';
import { Pagination } from '@/ui/admin/kit/Pagination';
import { SearchInput } from '@/ui/admin/kit/SearchInput';
import { SelectField } from '@/ui/admin/kit/SelectField';
import { StatusBadge } from '@/ui/admin/kit/StatusBadge';
import { Tabs } from '@/ui/admin/kit/Tabs';
import { FlashToast } from '@/ui/admin/kit/Toaster';
import { buildHref, firstParam, parseListParams, type SearchParams } from '@/ui/admin/kit/url';
import { fmtTime } from '../_lib/ui';
import { moderateReviewAction, replyReviewAction } from './actions';

import '../content/content-admin.css';

export const metadata: Metadata = { title: 'Отзывы' };
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Record<ReviewStatus, { text: string; tone: 'warning' | 'success' | 'neutral' }> = {
  pending: { text: 'На модерации', tone: 'warning' },
  published: { text: 'Опубликован', tone: 'success' },
  rejected: { text: 'Отклонён', tone: 'neutral' },
};
const SORTS = ['created', 'rating'] as const;
const MSK_OFFSET = '+03:00';
const DAY = 86_400_000;

const dayStart = (v: string): number | undefined => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00${MSK_OFFSET}`) : undefined);

function Decision({ id, decision, label, back, outline = true }: { id: number; decision: ReviewStatus; label: string; back: string; outline?: boolean }) {
  return (
    <form action={moderateReviewAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className={`ak-btn ak-btn--sm ${outline ? 'ak-btn--outline' : 'ak-btn--primary'}`}>
        {label}
      </button>
    </form>
  );
}

/** Модерация отзывов о товарах: фильтры, решение, ответ администратора. Право reviews.moderate. */
export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('reviews.moderate');
  const sp = await searchParams;
  const lp = parseListParams(sp, { sorts: SORTS, defaultSort: 'created', defaultDir: 'desc' });
  const statusRaw = firstParam(sp.status);
  const status = (['pending', 'published', 'rejected'] as const).find((s) => s === statusRaw);
  const ratingRaw = Number(firstParam(sp.rating));
  const rating = Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : undefined;
  const productRaw = Number(firstParam(sp.product));
  const productId = Number.isInteger(productRaw) && productRaw >= 1 ? productRaw : undefined;
  const from = dayStart(firstParam(sp.from));
  const toStart = dayStart(firstParam(sp.to));
  const sort = lp.sort === 'rating' ? (lp.dir === 'asc' ? 'rating_asc' : 'rating_desc') : lp.dir === 'asc' ? 'created_asc' : 'created_desc';

  const data = reviewsModeration.list(session, { status, rating, productId, from, to: toStart === undefined ? undefined : toStart + DAY - 1, q: lp.q || undefined, sort, page: lp.page, pageSize: lp.pageSize });
  const back = buildHref('/admin/reviews', sp, {});

  const columns: DataTableColumn<ReviewRow>[] = [
    { key: 'date', header: 'Когда', sortKey: 'created', cell: (r) => fmtTime(r.createdAt) },
    { key: 'product', header: 'Товар', hideOnNarrow: true, cell: (r) => (r.productName ? <Link href={`/product/${r.productSlug}`}>{r.productName}</Link> : '—') },
    { key: 'rating', header: 'Оценка', sortKey: 'rating', cell: (r) => `${r.rating} из 5` },
    {
      key: 'text',
      header: 'Автор и отзыв',
      cell: (r) => (
        <div>
          <strong>{r.authorName}</strong>
          <p className="ak-review-text">{r.body}</p>
          <details>
            <summary>{r.adminReply ? 'Ответ магазина' : 'Ответить'}</summary>
            <form action={replyReviewAction} className="ak-reply">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="back" value={back} />
              <label className="ak-field__label" htmlFor={`reply-${r.id}`}>
                Ответ администратора (виден на сайте под опубликованным отзывом)
              </label>
              <textarea id={`reply-${r.id}`} name="reply" rows={3} maxLength={2000} defaultValue={r.adminReply ?? ''} />
              <button type="submit" className="ak-btn ak-btn--sm ak-btn--primary">
                {r.adminReply ? 'Сохранить ответ' : 'Отправить ответ'}
              </button>
              <span className="ak-field__hint"> Пусто — ответ убирается.</span>
            </form>
          </details>
        </div>
      ),
    },
    { key: 'status', header: 'Статус', cell: (r) => <StatusBadge tone={STATUS_TEXT[r.status].tone}>{STATUS_TEXT[r.status].text}</StatusBadge> },
    {
      key: 'actions',
      header: 'Действия',
      width: '1%',
      cell: (r) => (
        <div className="ak-row-actions">
          {r.status !== 'published' ? <Decision id={r.id} decision="published" label="Опубликовать" back={back} outline={false} /> : null}
          {r.status !== 'rejected' ? <Decision id={r.id} decision="rejected" label={r.status === 'published' ? 'Снять с публикации' : 'Отклонить'} back={back} /> : null}
          {r.status !== 'pending' ? <Decision id={r.id} decision="pending" label="В ожидание" back={back} /> : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Отзывы" description="Отзыв виден на сайте только после публикации. Рейтинг товара считается по опубликованным отзывам; фиктивных отзывов нет." />
      <FlashToast ok={firstParam(sp.ok)} error={firstParam(sp.error)} okText="Готово." />
      <Tabs
        label="Статус отзывов"
        basePath="/admin/reviews"
        params={sp}
        param="status"
        active={status ?? ''}
        items={[
          { key: '', label: 'Все', count: data.counts.pending + data.counts.published + data.counts.rejected },
          { key: 'pending', label: 'На модерации', count: data.counts.pending },
          { key: 'published', label: 'Опубликованные', count: data.counts.published },
          { key: 'rejected', label: 'Отклонённые', count: data.counts.rejected },
        ]}
      />
      <div className="ak-toolbar">
        <SearchInput label="Поиск" placeholder="Автор, текст или товар" defaultValue={lp.q} />
      </div>
      <FilterPanel basePath="/admin/reviews" params={sp} preserve={['sort', 'dir', 'pageSize', 'q', 'status']}>
        <SelectField name="rating" label="Оценка" placeholder="Любая" options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} из 5` }))} defaultValue={rating ? String(rating) : ''} />
        <FormField name="from" label="Отзыв с" type="date" defaultValue={firstParam(sp.from)} />
        <FormField name="to" label="Отзыв по" type="date" defaultValue={firstParam(sp.to)} />
        <FormField name="product" label="Номер товара" inputMode="numeric" defaultValue={productId ? String(productId) : ''} hint="Из адреса товара в админке" />
      </FilterPanel>
      <DataTable<ReviewRow>
        caption="Отзывы о товарах"
        columns={columns}
        rows={data.rows}
        rowKey={(r) => r.id}
        basePath="/admin/reviews"
        params={sp}
        sort={lp.sort}
        dir={lp.dir}
        empty={{ title: 'Отзывов нет', description: 'Отзывы появляются, когда покупатели оставляют их на карточках товаров.' }}
        footer={<Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/admin/reviews" params={sp} />}
      />
    </>
  );
}
