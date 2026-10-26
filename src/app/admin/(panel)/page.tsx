import type { Metadata } from 'next';
import Link from 'next/link';
import { dashboard } from '@/domain/analytics/dashboard';
import { PERIOD_LABELS, PERIOD_PRESETS, parseDashboardPeriod } from '@/domain/analytics/period';
import { formatRub } from '@/domain/pricing/format';
import { STATUS_LABELS, isOrderStatus } from '@/domain/ordering/status';
import { SalesChart } from '@/ui/admin/SalesChart';
import { requireStaffPage } from '@/ui/admin/guard';
import { visibleNav } from '@/ui/admin/nav';
import { ErrorState, EmptyState } from '@/ui/states';
import { Stat, fmtTime } from './_lib/ui';
import './_lib/ops.css';
import '@/ui/admin/c10.css';
import '@/ui/cart/admin-orders.css';

export const metadata: Metadata = { title: 'Обзор' };
export const dynamic = 'force-dynamic';

const statusLabel = (s: string): string => (isOrderStatus(s) ? STATUS_LABELS[s] : s);

/** Панель управления: показатели за период по реальным данным БД; каждый блок скрыт, если у роли нет права. */
export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage();
  const sp = await searchParams;
  const { preset, range } = parseDashboardPeriod(sp);
  const by = (Array.isArray(sp.by) ? sp.by[0] : sp.by) === 'week' ? 'week' : 'day';
  const d = dashboard(session, range, by);
  const sections = visibleNav(session).filter((i) => i.href !== '/admin');
  const c = d.cards;
  const periodText = `${range.fromStr} — ${range.toStr}`;
  const keep = by === 'week' ? '&by=week' : '';

  return (
    <>
      <h1>Обзор</h1>
      {sp.forbidden ? (
        <ErrorState title="Недостаточно прав">
          <p>У вашей роли нет доступа к этому разделу.</p>
        </ErrorState>
      ) : null}

      <nav aria-label="Период">
        <ul className="dash-period">
          {PERIOD_PRESETS.filter((p) => p !== 'custom').map((p) => (
            <li key={p}>
              <Link href={`/admin?period=${p}${keep}`} aria-current={preset === p ? 'true' : undefined}>
                {PERIOD_LABELS[p]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form method="get" className="adm-filters" aria-label="Свой период и группировка">
        <div className="adm-field">
          <label htmlFor="ov-from">С даты</label>
          <input id="ov-from" name="from" type="date" defaultValue={range.fromStr} required />
        </div>
        <div className="adm-field">
          <label htmlFor="ov-to">По дату (включительно)</label>
          <input id="ov-to" name="to" type="date" defaultValue={range.toStr} required />
        </div>
        {c.revenue ? (
          <div className="adm-field">
            <label htmlFor="ov-by">График</label>
            <select id="ov-by" name="by" defaultValue={by}>
              <option value="day">по дням</option>
              <option value="week">по неделям</option>
            </select>
          </div>
        ) : null}
        <div className="adm-inline">
          <button type="submit" className="button">
            Показать
          </button>
        </div>
      </form>
      <p className="dash-muted">
        {preset === 'custom' ? PERIOD_LABELS.custom : PERIOD_LABELS[preset]}: {periodText}. Границы суток — по Москве. Показатели — из заказов, клиентов и обращений в базе магазина.
      </p>

      {d.hints.length > 0 ? (
        <section aria-label="Что делать дальше">
          <h2>Что делать дальше</h2>
          {d.hints.map((h) => (
            <p key={h.href} className="dash-hint">
              {h.text} <Link href={h.href}>{h.linkLabel}</Link>
            </p>
          ))}
        </section>
      ) : null}

      <ul className="ops-stats">
        {c.orders ? <Stat label="Заказов за период" value={c.orders.counted} hint={`создано всего: ${c.orders.created}, без отменённых и возвратов`} /> : null}
        {c.revenue ? (
          <Stat
            label="Выручка"
            value={formatRub(c.revenue.kopecks)}
            hint={`оплаченных заказов: ${c.revenue.paidOrders}${c.revenue.averageCheckKopecks === null ? '' : `, средний чек ${formatRub(c.revenue.averageCheckKopecks)}`}`}
          />
        ) : null}
        {c.products ? <Stat label="Товаров на сайте" value={`${c.products.visible} из ${c.products.total}`} hint="видимых покупателям / всего" /> : null}
        {c.outOfStock !== undefined ? <Stat label="Нет в наличии" value={c.outOfStock} /> : null}
        {c.newCustomers !== undefined ? <Stat label="Новые клиенты" value={c.newCustomers} hint="зарегистрировались за период" /> : null}
        {c.newInquiries !== undefined ? <Stat label="Новые обращения" value={c.newInquiries} hint="сообщения, звонки, вопросы" /> : null}
        {c.newRepairs !== undefined ? <Stat label="Заявки на ремонт" value={c.newRepairs} hint="за период" /> : null}
      </ul>

      {c.revenue ? (
        <section aria-labelledby="dash-sales" className="dash-card">
          <h2 id="dash-sales">Продажи {by === 'week' ? 'по неделям' : 'по дням'}</h2>
          {d.sales && d.sales.series.length > 0 ? (
            <SalesChart points={d.sales.series} caption={`Выручка ${by === 'week' ? 'по неделям' : 'по дням'}, ${periodText}`} />
          ) : (
            <EmptyState title="Нет данных">
              <p>За выбранный период заказов не было. График появится после первых заказов.</p>
            </EmptyState>
          )}
        </section>
      ) : null}

      <div className="dash-grid">
        {d.attention.orders ? (
          <section aria-labelledby="dash-attention" className="dash-card">
            <h2 id="dash-attention">Требуют внимания</h2>
            {d.attention.orders.total === 0 ? (
              <p className="dash-muted">Просроченных заказов нет: все новые и неоплаченные заказы моложе {d.attention.afterHours} ч.</p>
            ) : (
              <>
                <p className="dash-warn">
                  Ждут дольше {d.attention.afterHours} ч: {d.attention.orders.total}
                </p>
                <ul className="dash-list">
                  {d.attention.orders.items.map((o) => (
                    <li key={o.number}>
                      <Link href={`/admin/orders/${encodeURIComponent(o.number)}`}>{o.number}</Link>
                      <span className="dash-muted">
                        {statusLabel(o.status)}, {fmtTime(o.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {d.attention.integrations && d.attention.integrations.total > 0 ? (
              <p className="dash-warn">
                Интеграции и платежи с предупреждениями: {d.attention.integrations.total} (ошибок запуска за 7 дней {d.attention.integrations.failedRuns7d}, платежей {d.attention.integrations.paymentErrors}, уведомлений платёжной системы{' '}
                {d.attention.integrations.webhookAlerts}). <Link href="/admin/integrations">Открыть интеграции</Link>
              </p>
            ) : null}
          </section>
        ) : null}

        {d.recentOrders ? (
          <section aria-labelledby="dash-recent" className="dash-card">
            <h2 id="dash-recent">Последние заказы</h2>
            {d.recentOrders.length === 0 ? (
              <p className="dash-muted">Заказов пока нет.</p>
            ) : (
              <ul className="dash-list">
                {d.recentOrders.map((o) => (
                  <li key={o.number}>
                    <span>
                      <Link href={`/admin/orders/${encodeURIComponent(o.number)}`}>{o.number}</Link> · {o.contactName}
                    </span>
                    <span className="dash-muted">
                      {statusLabel(o.status)} · {formatRub(o.totalKopecks)} · {fmtTime(o.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {d.popular ? (
          <section aria-labelledby="dash-popular" className="dash-card">
            <h2 id="dash-popular">Популярные товары</h2>
            {d.popular.length === 0 ? (
              <p className="dash-muted">За период оплаченных заказов нет.</p>
            ) : (
              <ol className="dash-list">
                {d.popular.map((p, i) => (
                  <li key={p.productId ?? `x${i}`}>
                    <span>{p.productId !== null ? <Link href={`/admin/catalog/${p.productId}`}>{p.name}</Link> : p.name}</span>
                    <span className="dash-muted">продано: {p.units}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}

        {d.audit ? (
          <section aria-labelledby="dash-audit" className="dash-card">
            <h2 id="dash-audit">Последние события администрирования</h2>
            {d.audit.length === 0 ? (
              <p className="dash-muted">Журнал пуст.</p>
            ) : (
              <ul className="dash-list">
                {d.audit.map((a, i) => (
                  <li key={`${a.at}-${i}`}>
                    <span>
                      {a.action} · {a.entity}
                      {a.entityId ? ` ${a.entityId}` : ''}
                    </span>
                    <span className="dash-muted">
                      {a.actor ?? 'система'} · {fmtTime(a.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/admin/audit">Весь журнал</Link>
          </section>
        ) : null}
      </div>

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
