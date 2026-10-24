import type { Metadata } from 'next';
import Link from 'next/link';
import { parseBucket, parseRange } from '@/domain/analytics';
import { formatRub } from '@/domain/pricing/format';
import { requireStaffPage } from '@/ui/admin/guard';
import { ErrorState, EmptyState } from '@/ui/states';
import { visibleNav } from '@/ui/admin/nav';
import { overviewOps } from './_lib/overview-ops';
import { Stat } from './_lib/ui';
import './_lib/ops.css';
import '@/ui/cart/admin-orders.css';

export const metadata: Metadata = { title: 'Обзор' };
export const dynamic = 'force-dynamic';

const BUCKET_LABELS = { day: 'по дням', week: 'по неделям', month: 'по месяцам' } as const;

/** Обзор: показатели за период из реальных заказов; блоки скрыты, если у роли нет права. */
export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage();
  const sp = await searchParams;
  const range = parseRange(sp);
  const by = parseBucket(sp.by);
  const view = overviewOps.get(session, range, by);
  const sections = visibleNav(session).filter((i) => i.href !== '/admin');
  const maxRevenue = Math.max(1, ...(view.series ?? []).map((r) => r.revenueKopecks));
  const requestsTotal = view.requests.repair + view.requests.callback + view.requests.question + view.requests.reviewsPending;

  return (
    <>
      <h1>Обзор</h1>
      {sp.forbidden ? (
        <ErrorState title="Недостаточно прав">
          <p>У вашей роли нет доступа к этому разделу.</p>
        </ErrorState>
      ) : null}

      {view.orders ? (
        <form method="get" className="adm-filters" aria-label="Период обзора">
          <div className="adm-field">
            <label htmlFor="ov-from">С даты</label>
            <input id="ov-from" name="from" type="date" defaultValue={range.fromStr} required />
          </div>
          <div className="adm-field">
            <label htmlFor="ov-to">По дату (включительно)</label>
            <input id="ov-to" name="to" type="date" defaultValue={range.toStr} required />
          </div>
          {view.money ? (
            <div className="adm-field">
              <label htmlFor="ov-by">Динамика</label>
              <select id="ov-by" name="by" defaultValue={by}>
                {(Object.keys(BUCKET_LABELS) as (keyof typeof BUCKET_LABELS)[]).map((k) => (
                  <option key={k} value={k}>
                    {BUCKET_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="adm-inline">
            <button type="submit" className="button">
              Показать
            </button>
          </div>
        </form>
      ) : null}

      {view.orders ? (
        view.empty ? (
          <EmptyState title="Нет данных">
            <p>За выбранный период ({range.fromStr} — {range.toStr}) заказов не было.</p>
          </EmptyState>
        ) : (
          <ul className="ops-stats">
            {view.money ? <Stat label="Выручка" value={formatRub(view.money.revenueKopecks)} hint={`оплаченных заказов: ${view.money.paidOrders}`} /> : null}
            <Stat label="Заказов (без отменённых)" value={view.orders.counted} hint={`создано всего: ${view.orders.created}`} />
            {view.money ? <Stat label="Средний чек" value={view.money.averageCheckKopecks === null ? 'нет данных' : formatRub(view.money.averageCheckKopecks)} /> : null}
          </ul>
        )
      ) : null}

      <ul className="ops-stats">
        <Stat
          label="Новые заявки"
          value={view.requests.available ? requestsTotal : 'нет данных'}
          hint={view.requests.available ? `ремонт ${view.requests.repair}, звонок ${view.requests.callback}, вопросы ${view.requests.question}, отзывы на модерации ${view.requests.reviewsPending}` : 'раздел заявок ещё не подключён'}
        />
        {view.attention ? (
          <Stat
            label="Ошибки интеграций"
            value={view.attention.total}
            hint={`запусков с ошибкой за 7 дней ${view.attention.failedRuns7d}, платежей ${view.attention.paymentErrors}, уведомлений ${view.attention.webhookAlerts}`}
          />
        ) : null}
      </ul>

      {view.series && view.series.length > 0 ? (
        <>
          <h2>Динамика {BUCKET_LABELS[by]}</h2>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Заказы и выручка по периодам</caption>
              <thead>
                <tr>
                  <th scope="col">Период</th>
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
                {view.series.map((r) => (
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
        </>
      ) : null}

      <h2>Разделы</h2>
      <ul className="admin-cards">
        {sections.map((s) => (
          <li key={s.key} className="admin-card">
            <Link href={s.href}>{s.label}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
