import type { Metadata } from 'next';
import { mailAdmin } from '@/integrations/mail/admin-ops';
import type { OutboxStatus } from '@/server/db/repositories/email-outbox';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { Flash, fmtTime, INTEGRATION_NAV, Stat, str, SubNav } from '../_lib/ui';
import { retryMailAction } from './actions';

export const metadata: Metadata = { title: 'Почта' };
export const dynamic = 'force-dynamic';

const STATUS: Record<OutboxStatus, { text: string; cls: string }> = {
  pending: { text: 'в очереди', cls: 'ops-badge--warn' },
  sending: { text: 'отправляется', cls: '' },
  sent: { text: 'отправлено', cls: 'ops-badge--ok' },
  failed: { text: 'не отправлено', cls: 'ops-badge--error' },
};
const AUDIENCE = { customer: 'клиент', manager: 'менеджеры', admin: 'администраторы' } as const;
const NAV = [...INTEGRATION_NAV, { href: '/admin/mail', label: 'Почта' }];

export default async function AdminMailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('integrations.run');
  const sp = await searchParams;
  const view = mailAdmin.overview(session);

  return (
    <>
      <h1>Почта</h1>
      <SubNav items={NAV} current="/admin/mail" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Письмо поставлено на повторную отправку." />

      {view.warnings.map((w) => (
        <p key={w} className="adm-flash adm-flash--error" role="alert">
          {w}
        </p>
      ))}

      <p>
        Режим:{' '}
        <span className={`ops-badge ${view.status.connected ? 'ops-badge--ok' : 'ops-badge--warn'}`}>{view.status.connected ? 'SMTP подключён' : 'не подключено — заглушка'}</span>{' '}
        <span className="ops-muted">{view.status.note}</span>
      </p>
      <ul className="ops-stats">
        <Stat label="В очереди" value={view.counts.pending + view.counts.sending} />
        <Stat label="Отправлено" value={view.counts.sent} />
        <Stat label="Не отправлено" value={view.counts.failed} />
      </ul>
      <p className="ops-muted">
        Тексты писем и ссылки (например, для сброса пароля) здесь не показываются, а после отправки удаляются из очереди. Неудачная отправка повторяется до 3 раз с паузой.
      </p>

      {view.rows.length === 0 ? (
        <EmptyState title="Писем пока не было" />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Журнал исходящей почты</caption>
            <thead>
              <tr>
                <th scope="col">Создано</th>
                <th scope="col">Тема</th>
                <th scope="col">Кому</th>
                <th scope="col">Статус</th>
                <th scope="col">Попытки</th>
                <th scope="col">Ошибка</th>
                <th scope="col">Действия</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtTime(r.createdAt)}</td>
                  <td>{r.subject}</td>
                  <td>{r.to ?? AUDIENCE[r.audience]}</td>
                  <td>
                    <span className={`ops-badge ${STATUS[r.status].cls}`}>{STATUS[r.status].text}</span>
                  </td>
                  <td>{r.attempts}</td>
                  <td>{r.lastError ?? '—'}</td>
                  <td>
                    {r.status === 'failed' ? (
                      <form action={retryMailAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" className="button button--outline button--small">
                          Повторить
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
