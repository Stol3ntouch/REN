import type { Metadata } from 'next';
import Link from 'next/link';
import { reviewsAdmin } from '@/domain/requests/admin-ops';
import type { ReviewStatus } from '@/server/db/repositories/reviews';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { Flash, fmtTime, str, SubNav } from '../_lib/ui';
import { REQUESTS_NAV } from '../requests/nav';
import { moderateReviewAction } from './actions';

export const metadata: Metadata = { title: 'Отзывы' };
export const dynamic = 'force-dynamic';

const LABELS: Record<ReviewStatus, { text: string; cls: string }> = {
  pending: { text: 'на модерации', cls: 'ops-badge--warn' },
  published: { text: 'опубликован', cls: 'ops-badge--ok' },
  rejected: { text: 'отклонён', cls: '' },
};
const FILTERS: [string, string][] = [
  ['', 'Все'],
  ['pending', 'На модерации'],
  ['published', 'Опубликованные'],
  ['rejected', 'Отклонённые'],
];

export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('reviews.moderate');
  const sp = await searchParams;
  const status = str(sp.status);
  const rows = reviewsAdmin.list(session, { status });

  return (
    <>
      <h1>Отзывы</h1>
      <SubNav items={REQUESTS_NAV} current="/admin/reviews" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Готово." />
      <p className="ops-muted">Отзыв виден на сайте только после публикации. Рейтинг товара считается по опубликованным отзывам.</p>
      <nav aria-label="Фильтр по статусу">
        <ul className="ops-subnav">
          {FILTERS.map(([v, l]) => (
            <li key={v}>
              <Link href={v ? `/admin/reviews?status=${v}` : '/admin/reviews'} aria-current={status === v ? 'page' : undefined}>
                {l}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {rows.length === 0 ? (
        <EmptyState title="Отзывов нет" />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Отзывы о товарах</caption>
            <thead>
              <tr>
                <th scope="col">Когда</th>
                <th scope="col">Товар</th>
                <th scope="col">Оценка</th>
                <th scope="col">Автор и текст</th>
                <th scope="col">Статус</th>
                <th scope="col">Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = LABELS[r.status];
                return (
                  <tr key={r.id}>
                    <td>{fmtTime(r.createdAt)}</td>
                    <td>{r.productName ? <Link href={`/product/${r.productSlug}`}>{r.productName}</Link> : '—'}</td>
                    <td>{r.rating} из 5</td>
                    <td>
                      <strong>{r.authorName}</strong>
                      <br />
                      {r.body}
                    </td>
                    <td>
                      <span className={`ops-badge ${st.cls}`}>{st.text}</span>
                    </td>
                    <td>
                      <div className="adm-inline">
                        {r.status !== 'published' ? (
                          <form action={moderateReviewAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="decision" value="published" />
                            <button type="submit" className="button button--small">
                              Опубликовать
                            </button>
                          </form>
                        ) : null}
                        {r.status !== 'rejected' ? (
                          <form action={moderateReviewAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="decision" value="rejected" />
                            <button type="submit" className="button button--outline button--small">
                              {r.status === 'published' ? 'Снять с публикации' : 'Отклонить'}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
