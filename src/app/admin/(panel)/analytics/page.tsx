import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { canExportStats, canStats, LOW_STOCK_THRESHOLD, REVENUE_DEFINITION, STATS_CSV_KINDS, statsOps, type StatsCsvKind } from '@/domain/analytics/stats';
import { PERIOD_LABELS, PERIOD_PRESETS, parseDashboardPeriod } from '@/domain/analytics/period';
import { parseBucket } from '@/domain/analytics';
import { STATUS_LABELS, isOrderStatus } from '@/domain/ordering/status';
import { formatRub } from '@/domain/pricing/format';
import { SalesChart } from '@/ui/admin/SalesChart';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { Stat } from '../_lib/ui';
import '../_lib/ops.css';
import '@/ui/admin/c10.css';
import '@/ui/cart/admin-orders.css';

export const metadata: Metadata = { title: 'Статистика' };
export const dynamic = 'force-dynamic';

const CSV_LABELS: Record<StatsCsvKind, string> = {
  series: 'Динамика продаж',
  categories: 'По категориям',
  products: 'По товарам',
  cancellations: 'Отмены и возвраты',
  statuses: 'Заказы по статусам',
  stock: 'Заканчивающиеся товары',
};
const MONEY_KINDS: readonly StatsCsvKind[] = ['series', 'categories', 'products', 'cancellations'];
const BUCKET_LABELS = { day: 'по дням', week: 'по неделям', month: 'по месяцам' } as const;

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage();
  if (!canStats(session)) redirect('/admin?forbidden=1');
  const sp = await searchParams;
  const { preset, range } = parseDashboardPeriod(sp);
  const by = parseBucket(sp.by);
  const r = statsOps.report(session, range, by);
  const canExport = canExportStats(session);
  const empty = r.summary.ordersCreated === 0;
  const exportHref = (k: StatsCsvKind) => `/admin/analytics/export?${new URLSearchParams({ kind: k, from: range.fromStr, to: range.toStr, by }).toString()}`;
  const label = (s: string): string => (isOrderStatus(s) ? STATUS_LABELS[s] : s);

  return (
    <>
      <h1>Статистика</h1>
      <nav aria-label="Период">
        <ul className="dash-period">
          {PERIOD_PRESETS.filter((p) => p !== 'custom').map((p) => (
            <li key={p}>
              <Link href={`/admin/analytics?period=${p}&by=${by}`} aria-current={preset === p ? 'true' : undefined}>
                {PERIOD_LABELS[p]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
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
      <p className="dash-muted">
        Период: {range.fromStr} — {range.toStr}, границы суток по Москве. Только реальные данные магазина. {r.money ? REVENUE_DEFINITION : ''}
      </p>

      <h2>Продажи</h2>
      {empty ? (
        <EmptyState title="Нет данных">
          <p>За выбранный период заказов не было. Показатели появятся после первых заказов.</p>
        </EmptyState>
      ) : (
        <>
          <ul className="ops-stats">
            {r.money ? <Stat label="Выручка" value={formatRub(r.summary.revenueKopecks)} hint={`оплаченных заказов: ${r.summary.paidOrders}`} /> : null}
            <Stat label="Заказов (без отменённых)" value={r.summary.ordersCounted} hint={`создано всего: ${r.summary.ordersCreated}`} />
            {r.money ? <Stat label="Средний чек" value={r.summary.averageCheckKopecks === null ? 'нет данных' : formatRub(r.summary.averageCheckKopecks)} /> : null}
            {r.margin ? (
              <Stat
                label="Маржа"
                value={formatRub(r.margin.marginKopecks)}
                hint={`по строкам с закупочной ценой: ${r.margin.knownLines} из ${r.margin.lines} (${r.margin.coveragePercent}%)`}
              />
            ) : null}
          </ul>
          {r.marginHidden === 'no-cost' ? <p className="dash-muted">Маржа не показана: у проданных товаров не заполнена закупочная цена.</p> : null}
          {r.money && r.series.length > 0 ? (
            <SalesChart points={r.series} caption={`Выручка ${BUCKET_LABELS[by]}, ${range.fromStr} — ${range.toStr}`} />
          ) : null}
          {!r.money && r.series.length > 0 ? (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <caption className="visually-hidden">Заказы по периодам</caption>
                <thead>
                  <tr>
                    <th scope="col">Период</th>
                    <th scope="col" className="num">
                      Заказов
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.series.map((s) => (
                    <tr key={s.bucket}>
                      <td>{s.bucket}</td>
                      <td className="num">{s.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <h2>Заказы по статусам</h2>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Заказы по статусам</caption>
              <thead>
                <tr>
                  <th scope="col">Статус</th>
                  <th scope="col" className="num">
                    Заказов
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.statuses.map((s) => (
                  <tr key={s.status}>
                    <td>{label(s.status)}</td>
                    <td className="num">{s.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="ops-stats">
            <Stat label="Отменено" value={r.cancellations.cancelled} hint={r.money ? formatRub(r.cancellations.cancelledKopecks) : undefined} />
            <Stat label="Возвращено" value={r.cancellations.refunded} hint={r.money ? formatRub(r.cancellations.refundedKopecks) : undefined} />
            <Stat label="Доля отмен и возвратов" value={`${r.cancellations.sharePercent}%`} hint="от созданных за период" />
          </ul>

          <h2>Товары и категории</h2>
          {r.topProducts.length === 0 ? (
            <p className="dash-muted">Оплаченных заказов за период нет.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <caption>Топ-10 товаров по выручке</caption>
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col">Артикул</th>
                    <th scope="col" className="num">
                      Штук
                    </th>
                    {r.money ? (
                      <th scope="col" className="num">
                        Выручка
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {r.topProducts.map((p, i) => (
                    <tr key={p.productId ?? `x${i}`}>
                      <td>{p.name}</td>
                      <td>{p.sku ?? '—'}</td>
                      <td className="num">{p.units}</td>
                      {r.money ? <td className="num">{formatRub(p.revenueKopecks)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.categories.length > 0 ? (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <caption>Продажи по категориям</caption>
                <thead>
                  <tr>
                    <th scope="col">Категория</th>
                    <th scope="col" className="num">
                      Штук
                    </th>
                    {r.money ? (
                      <th scope="col" className="num">
                        Выручка
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {r.categories.map((c) => (
                    <tr key={c.categoryId ?? 'none'}>
                      <td>{c.name}</td>
                      <td className="num">{c.units}</td>
                      {r.money ? <td className="num">{formatRub(c.revenueKopecks)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}

      <h2>Клиенты</h2>
      <ul className="ops-stats">
        <Stat label="Новые регистрации" value={r.customers.registered} hint="за период" />
        <Stat label="Покупатели периода" value={r.customers.buyers} hint="сделали заказ (гости считаются по устройству)" />
        <Stat label="Новые покупатели" value={r.customers.newBuyers} hint="раньше не заказывали" />
        <Stat label="Повторные покупатели" value={r.customers.repeatBuyers} hint="заказывали и раньше" />
      </ul>

      {hasPermission(session, 'products.read') || hasPermission(session, 'warehouses.write') ? (
        <>
          <h2>Остатки</h2>
          <ul className="ops-stats">
            <Stat label="Нет в наличии" value={r.stock.outOfStock} />
            <Stat label="Заканчиваются" value={r.stock.lowTotal} hint={`свободный остаток от 1 до ${LOW_STOCK_THRESHOLD} при включённом учёте`} />
          </ul>
          {r.stock.low.length > 0 ? (
            <ul className="dash-list">
              {r.stock.low.map((p) => (
                <li key={p.productId}>
                  <Link href={`/admin/catalog/${p.productId}`}>{p.name}</Link>
                  <span className="dash-muted">
                    {p.sku ? `${p.sku} · ` : ''}свободно: {p.free}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dash-muted">Товаров с малым остатком нет.</p>
          )}
        </>
      ) : null}

      {canExport ? (
        <>
          <h2>Выгрузка в CSV</h2>
          <p className="dash-muted">Файл в UTF-8 (открывается в Excel), разделитель «;». Данные за выбранный период.</p>
          <ul className="adm-inline" style={{ listStyle: 'none', padding: 0 }}>
            {STATS_CSV_KINDS.filter((k) => r.money || !MONEY_KINDS.includes(k)).map((k) => (
              <li key={k}>
                <a className="button button--outline" href={exportHref(k)} download>
                  {CSV_LABELS[k]}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
