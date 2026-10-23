import type { Metadata } from 'next';
import { analyticsOps, CSV_KINDS, parseBucket, parseRange, type CsvKind } from '@/domain/analytics';
import { formatRub } from '@/domain/pricing/format';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { Stat } from '../_lib/ui';
import '../_lib/ops.css';
import '@/ui/cart/admin-orders.css';

export const metadata: Metadata = { title: 'Аналитика' };
export const dynamic = 'force-dynamic';

const CSV_LABELS: Record<CsvKind, string> = {
  series: 'Динамика',
  categories: 'По категориям',
  products: 'По товарам',
  cancellations: 'Отмены и возвраты',
};
const BUCKET_LABELS = { day: 'по дням', week: 'по неделям', month: 'по месяцам' } as const;

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('analytics.read');
  const sp = await searchParams;
  const range = parseRange(sp);
  const by = parseBucket(sp.by);
  const report = analyticsOps.report(session, range, by);
  const { summary, series, empty } = report.overview;
  const maxRevenue = Math.max(1, ...series.map((r) => r.revenueKopecks));

  return (
    <>
      <h1>Аналитика</h1>
      <form method="get" className="adm-filters" aria-label="Период отчёта">
        <div className="adm-field">
          <label htmlFor="an-from">С даты</label>
          <input id="an-from" name="from" type="date" defaultValue={range.fromStr} required />
        </div>
        <div className="adm-field">
          <label htmlFor="an-to">По дату (включительно)</label>
          <input id="an-to" name="to" type="date" defaultValue={range.toStr} required />
        </div>
        <div className="adm-field">
          <label htmlFor="an-by">Динамика</label>
          <select id="an-by" name="by" defaultValue={by}>
            {(Object.keys(BUCKET_LABELS) as (keyof typeof BUCKET_LABELS)[]).map((k) => (
              <option key={k} value={k}>
                {BUCKET_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Показать
          </button>
        </div>
      </form>
      <p className="ops-muted">
        Только реальные данные магазина. Выручка — оплаченные заказы, кроме отменённых, возвращённых и с ошибкой оплаты; заказы с оплатой при получении учитываются после того, как оплата отмечена.
      </p>

      {empty ? (
        <EmptyState title="Нет данных">
          <p>За выбранный период заказов не было.</p>
        </EmptyState>
      ) : (
        <>
          <ul className="ops-stats">
            <Stat label="Выручка" value={formatRub(summary.revenueKopecks)} hint={`оплаченных заказов: ${summary.paidOrders}`} />
            <Stat label="Заказов (без отменённых)" value={summary.ordersCounted} hint={`создано всего: ${summary.ordersCreated}`} />
            <Stat label="Средний чек" value={summary.averageCheckKopecks === null ? 'нет данных' : formatRub(summary.averageCheckKopecks)} />
          </ul>

          <h2>Динамика {BUCKET_LABELS[by]}</h2>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Заказы и выручка по периодам</caption>
              <thead>
                <tr>
                  <th scope="col">{by === 'day' ? 'День' : by === 'week' ? 'Неделя с' : 'Месяц'}</th>
                  <th scope="col" className="num">
                    Заказов
                  </th>
                  <th scope="col" className="num">
                    Выручка
                  </th>
                  <th scope="col" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {series.map((r) => (
                  <tr key={r.bucket}>
                    <td>{r.bucket}</td>
                    <td className="num">{r.orders}</td>
                    <td className="num">{formatRub(r.revenueKopecks)}</td>
                    <td className="ops-bar-cell" aria-hidden="true">
                      <span className="ops-bar" style={{ width: `${Math.round((r.revenueKopecks / maxRevenue) * 100)}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Продажи по категориям</h2>
          {report.categories.length === 0 ? (
            <p className="ops-muted">Оплаченных заказов за период нет.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <caption className="visually-hidden">Продажи по категориям</caption>
                <thead>
                  <tr>
                    <th scope="col">Категория</th>
                    <th scope="col" className="num">
                      Штук
                    </th>
                    <th scope="col" className="num">
                      Выручка
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.categories.map((c) => (
                    <tr key={c.categoryId ?? 'none'}>
                      <td>{c.name}</td>
                      <td className="num">{c.units}</td>
                      <td className="num">{formatRub(c.revenueKopecks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>Продажи по товарам (топ-20)</h2>
          {report.products.length === 0 ? (
            <p className="ops-muted">Оплаченных заказов за период нет.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <caption className="visually-hidden">Продажи по товарам</caption>
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col">Артикул</th>
                    <th scope="col" className="num">
                      Штук
                    </th>
                    <th scope="col" className="num">
                      Выручка
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((p, i) => (
                    <tr key={p.productId ?? `x${i}`}>
                      <td>{p.name}</td>
                      <td>{p.sku ?? '—'}</td>
                      <td className="num">{p.units}</td>
                      <td className="num">{formatRub(p.revenueKopecks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>Отмены и возвраты</h2>
          <ul className="ops-stats">
            <Stat label="Отменено" value={report.cancellations.cancelled} hint={formatRub(report.cancellations.cancelledKopecks)} />
            <Stat label="Возвращено" value={report.cancellations.refunded} hint={formatRub(report.cancellations.refundedKopecks)} />
            <Stat label="Доля от созданных" value={`${report.cancellations.sharePercent}%`} />
          </ul>
        </>
      )}

      <h2>Выгрузка в CSV</h2>
      <p className="ops-muted">Файл в UTF-8 (открывается в Excel), разделитель «;». Данные за выбранный период.</p>
      <ul className="adm-inline" style={{ listStyle: 'none', padding: 0 }}>
        {CSV_KINDS.map((k) => (
          <li key={k}>
            <a className="button button--outline" href={`/admin/analytics/export?${new URLSearchParams({ kind: k, from: range.fromStr, to: range.toStr, by }).toString()}`} download>
              {CSV_LABELS[k]}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
