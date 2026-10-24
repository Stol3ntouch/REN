import type { Metadata } from 'next';
import { hasPermission } from '@/domain/admin/permissions';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { integrationsOps } from '../_lib/integrations-ops';
import { Flash, fmtTime, INTEGRATION_NAV, str, SubNav } from '../_lib/ui';
import { retryRunAction, runIntegrationAction } from './actions';

export const metadata: Metadata = { title: 'Интеграции' };
export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  'onec.pull_catalog': '1С: каталог из inbox',
  'onec.push_order': '1С: выгрузка заказов',
  'onec.pull_statuses': '1С: статусы заказов',
  'payment.create_payment': 'Оплата: создание платежа',
  'payment.webhook': 'Оплата: webhook',
  'payment.refund': 'Оплата: возврат',
};
const STATUS_LABELS: Record<string, { text: string; cls: string }> = {
  ok: { text: 'успешно', cls: 'ops-badge--ok' },
  partial: { text: 'частично', cls: 'ops-badge--warn' },
  error: { text: 'ошибка', cls: 'ops-badge--error' },
  running: { text: 'выполняется', cls: '' },
};
const RETRYABLE = new Set(['onec.pull_catalog', 'onec.push_order', 'onec.pull_statuses']);

export default async function AdminIntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('integrations.read');
  const sp = await searchParams;
  const view = integrationsOps.overview(session);
  const canRun = hasPermission(session, 'integrations.run');

  return (
    <>
      <h1>Интеграции</h1>
      <SubNav items={INTEGRATION_NAV} current="/admin/integrations" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Запуск выполнен — результат в журнале ниже." />

      <h2>Состояние</h2>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <caption className="visually-hidden">Состояние интеграций</caption>
          <thead>
            <tr>
              <th scope="col">Интеграция</th>
              <th scope="col">Режим</th>
              <th scope="col">Пояснение</th>
            </tr>
          </thead>
          <tbody>
            {view.ports.map((p) => (
              <tr key={p.key}>
                <td>{p.label}</td>
                <td>
                  <span className={`ops-badge ${p.status.connected ? 'ops-badge--ok' : 'ops-badge--warn'}`}>{p.status.connected ? 'подключено' : 'не подключено — заглушка'}</span>
                </td>
                <td>{p.status.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="adm-card" aria-labelledby="onec-h">
        <h2 id="onec-h">Обмен с 1С (файловая заглушка)</h2>
        <p>
          Заказов выгружено в outbox: {view.onec.exportedOrders}; ожидают выгрузки: {view.onec.pendingOrders}. Каталог читается из <code>data/onec-inbox/*.yml</code>, статусы — из{' '}
          <code>data/onec-inbox/statuses.json</code>.
        </p>
        {canRun ? (
          <div className="adm-inline">
            {(
              [
                ['push_orders', 'Выгрузить заказы'],
                ['pull_catalog', 'Загрузить каталог'],
                ['pull_statuses', 'Загрузить статусы'],
              ] as const
            ).map(([action, label]) => (
              <form key={action} action={runIntegrationAction}>
                <input type="hidden" name="action" value={action} />
                <button type="submit" className="button button--outline">
                  {label}
                </button>
              </form>
            ))}
          </div>
        ) : (
          <p className="ops-readonly">Запуск обмена доступен администратору. Вам открыт журнал.</p>
        )}
        <p className="ops-muted">Все запуски безопасно повторяются: заказ уходит в outbox один раз, импорт каталога не создаёт дублей, свежие значения не затираются.</p>
      </section>

      <h2>Журнал запусков</h2>
      {view.runs.length === 0 ? (
        <EmptyState title="Запусков пока не было" />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Журнал запусков интеграций</caption>
            <thead>
              <tr>
                <th scope="col">Когда</th>
                <th scope="col">Операция</th>
                <th scope="col">Статус</th>
                <th scope="col">Записи</th>
                <th scope="col">Ошибки</th>
                <th scope="col">Кто</th>
                {canRun ? <th scope="col">Действия</th> : null}
              </tr>
            </thead>
            <tbody>
              {view.runs.map((r) => {
                const st = STATUS_LABELS[r.status] ?? { text: r.status, cls: '' };
                return (
                  <tr key={r.id}>
                    <td>{fmtTime(r.startedAt)}</td>
                    <td>{KIND_LABELS[r.kind] ?? r.kind}</td>
                    <td>
                      <span className={`ops-badge ${st.cls}`}>{st.text}</span>
                    </td>
                    <td>
                      {Object.entries(r.counts)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ') || '—'}
                    </td>
                    <td>
                      {r.errors.length === 0 ? (
                        '—'
                      ) : (
                        <ul className="ops-errors">
                          {r.errors.slice(0, 5).map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                          {r.errors.length > 5 ? <li>… и ещё {r.errors.length - 5}</li> : null}
                        </ul>
                      )}
                    </td>
                    <td>{r.actor}</td>
                    {canRun ? (
                      <td>
                        {RETRYABLE.has(r.kind) && r.status !== 'ok' ? (
                          <form action={retryRunAction}>
                            <input type="hidden" name="runId" value={r.id} />
                            <button type="submit" className="button button--outline">
                              Повторить
                            </button>
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>Оплата: требует внимания</h2>
      {view.paymentErrors.length === 0 && view.webhookAttention.length === 0 ? (
        <p className="ops-muted">Ошибок оплаты и подозрительных уведомлений нет.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Ошибки оплаты и уведомления, требующие реакции</caption>
            <thead>
              <tr>
                <th scope="col">Когда</th>
                <th scope="col">Тип</th>
                <th scope="col">Заказ (id)</th>
                <th scope="col">Описание</th>
              </tr>
            </thead>
            <tbody>
              {view.paymentErrors.map((p) => (
                <tr key={`p${p.id}`}>
                  <td>{fmtTime(p.createdAt)}</td>
                  <td>ошибка платежа ({p.provider})</td>
                  <td>{p.orderId}</td>
                  <td>{[p.errorCode, p.errorMessage].filter(Boolean).join(': ') || '—'}</td>
                </tr>
              ))}
              {view.webhookAttention.map((w) => (
                <tr key={`w${w.id}`}>
                  <td>{fmtTime(w.receivedAt)}</td>
                  <td>уведомление {w.outcome === 'alert' ? '(нужна реакция)' : '(сбой)'}</td>
                  <td>{w.orderId ?? '—'}</td>
                  <td>{w.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Переменные окружения</h2>
      <p className="ops-muted">Значения не показываются никогда — только имя и признак «задан / не задан». Секреты хранятся в .env на сервере.</p>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <caption className="visually-hidden">Переменные окружения интеграций</caption>
          <thead>
            <tr>
              <th scope="col">Переменная</th>
              <th scope="col">Назначение</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {view.env.map((e) => (
              <tr key={e.name}>
                <td>
                  <code>{e.name}</code>
                </td>
                <td>{e.purpose}</td>
                <td>
                  <span className={`ops-badge ${e.set ? 'ops-badge--ok' : ''}`}>{e.set ? 'задан' : 'не задан'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
