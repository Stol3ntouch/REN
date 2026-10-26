import type { Metadata } from 'next';
import Link from 'next/link';
import { AUDIENCE_LABELS, MAIL_EVENTS } from '@/integrations/mail/settings';
import { mailSettingsAdmin } from '@/integrations/mail/settings-ops';
import type { OutboxStatus } from '@/server/db/repositories/email-outbox';
import { requireStaffPage } from '@/ui/admin/guard';
import { PageHeader } from '@/ui/admin/kit';
import { EmptyState } from '@/ui/states';
import { Flash, fmtTime, int, Stat, str } from '../../_lib/ui';
import { SettingsTabs } from '../SettingsTabs';
import { retryMailAction } from './actions';
import { SmtpTestForm, TemplateEditor } from './EmailForms';

export const metadata: Metadata = { title: 'Email и уведомления' };
export const dynamic = 'force-dynamic';

const STATUS: Record<OutboxStatus, { text: string; cls: string }> = {
  pending: { text: 'в очереди', cls: 'ops-badge--warn' },
  sending: { text: 'отправляется', cls: '' },
  sent: { text: 'отправлено', cls: 'ops-badge--ok' },
  failed: { text: 'не отправлено', cls: 'ops-badge--error' },
};
const PAGE = 30;

const day = (v: string, end: boolean): number | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isNaN(t) ? undefined : end ? t + 86_400_000 : t;
};

export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('email.write');
  const sp = await searchParams;
  const view = mailSettingsAdmin.view(session);
  const status = (['pending', 'sending', 'sent', 'failed'] as const).find((s) => s === str(sp.status));
  const event = MAIL_EVENTS.find((e) => e.event === str(sp.event))?.event;
  const page = int(sp.page, 1);
  const journal = mailSettingsAdmin.journal(session, {
    status,
    event,
    from: day(str(sp.from), false),
    to: day(str(sp.to), true),
    q: str(sp.q).trim().slice(0, 100) || undefined,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const pages = Math.max(1, Math.ceil(journal.total / PAGE));
  const link = (p: number) => {
    const qs = new URLSearchParams();
    for (const k of ['status', 'event', 'from', 'to', 'q']) if (str(sp[k])) qs.set(k, str(sp[k]));
    qs.set('page', String(p));
    return `/admin/settings/email?${qs.toString()}#journal`;
  };
  const smtp = view.smtp;

  return (
    <>
      <PageHeader title="Настройки магазина" description="Email и уведомления" />
      <SettingsTabs current="email" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />

      <section className="adm-card" aria-labelledby="smtp-h">
        <h2 id="smtp-h">Почтовый сервис (SMTP)</h2>
        <p>
          Состояние:{' '}
          <span className={`ops-badge ${smtp.status.connected ? 'ops-badge--ok' : 'ops-badge--warn'}`}>{smtp.status.connected ? 'SMTP настроен' : 'SMTP не настроен — письма копятся в очереди'}</span>
        </p>
        <p className="ops-muted">{smtp.status.note}</p>
        <ul>
          <li>Сервер (MAIL_HOST): {smtp.host ? 'задан' : 'не задан'}</li>
          <li>Порт (MAIL_PORT): {smtp.port ?? 'по умолчанию 587'}</li>
          <li>Отправитель (MAIL_FROM): {smtp.from ? 'задан' : 'не задан'}</li>
          <li>Пользователь (MAIL_USER): {smtp.user ? 'задан' : 'не задан'}</li>
          <li>Пароль (MAIL_PASSWORD): {smtp.password ? 'задан' : 'не задан'}</li>
        </ul>
        <p className="ops-muted">Параметры SMTP и пароль задаются только в окружении сервера (.env), в админке они не хранятся и не показываются.</p>
        {smtp.lastCheck ? (
          <p>
            Последняя проверка: <span className={`ops-badge ${smtp.lastCheck.ok ? 'ops-badge--ok' : 'ops-badge--error'}`}>{smtp.lastCheck.ok ? 'успешно' : 'ошибка'}</span> {fmtTime(smtp.lastCheck.at)}
            {smtp.lastCheck.message ? ` — ${smtp.lastCheck.message}` : ''}
          </p>
        ) : null}
        <SmtpTestForm />
      </section>

      <h2>События и шаблоны</h2>
      <p className="ops-muted">
        Для каждого события выберите, кому отправлять письмо, и при желании измените текст. Пока шаблон не сохранён, действует текст по умолчанию. «Предпросмотр» и тестовая отправка используют вымышленные данные.
      </p>
      {view.events.map((e) => (
        <details key={e.event} className="adm-card">
          <summary>
            {e.label} — {e.audiences.map((a) => `${AUDIENCE_LABELS[a.audience]}: ${a.enabled ? 'да' : 'нет'}`).join(', ')}
          </summary>
          <p className="ops-muted">{e.description}</p>
          {e.audiences.map((a) => (
            <TemplateEditor key={a.audience} event={e.event} audience={{ ...a, label: AUDIENCE_LABELS[a.audience] }} />
          ))}
        </details>
      ))}

      <h2 id="journal">Журнал отправки</h2>
      <ul className="ops-stats">
        <Stat label="В очереди" value={view.counts.pending + view.counts.sending} />
        <Stat label="Отправлено" value={view.counts.sent} />
        <Stat label="Не отправлено" value={view.counts.failed} />
      </ul>
      <p className="ops-muted">Текст письма и ссылки (например, сброс пароля) здесь не показываются и после отправки удаляются из очереди вместе с данными клиента. Неудачная отправка повторяется до 3 раз.</p>
      <form method="get" className="adm-filters" role="search" aria-label="Фильтр журнала" action="/admin/settings/email">
        <div className="adm-field">
          <label htmlFor="j-st">Статус</label>
          <select id="j-st" name="status" defaultValue={status ?? ''}>
            <option value="">Любой</option>
            {(Object.keys(STATUS) as OutboxStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s].text}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor="j-ev">Событие</label>
          <select id="j-ev" name="event" defaultValue={event ?? ''}>
            <option value="">Любое</option>
            {MAIL_EVENTS.map((e) => (
              <option key={e.event} value={e.event}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor="j-from">С даты</label>
          <input id="j-from" name="from" type="date" defaultValue={str(sp.from)} />
        </div>
        <div className="adm-field">
          <label htmlFor="j-to">По дату</label>
          <input id="j-to" name="to" type="date" defaultValue={str(sp.to)} />
        </div>
        <div className="adm-field">
          <label htmlFor="j-q">Тема содержит</label>
          <input id="j-q" name="q" type="search" defaultValue={str(sp.q)} maxLength={100} />
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Показать
          </button>
        </div>
      </form>
      {journal.rows.length === 0 ? (
        <EmptyState title="Писем не найдено" />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Журнал исходящей почты</caption>
            <thead>
              <tr>
                <th scope="col">Создано</th>
                <th scope="col">Событие</th>
                <th scope="col">Тема</th>
                <th scope="col">Кому</th>
                <th scope="col">Статус</th>
                <th scope="col">Попытки</th>
                <th scope="col">Ошибка</th>
                <th scope="col">Действия</th>
              </tr>
            </thead>
            <tbody>
              {journal.rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtTime(r.createdAt)}</td>
                  <td>{MAIL_EVENTS.find((e) => e.event === r.event)?.label ?? r.event}</td>
                  <td>{r.subject}</td>
                  <td>{r.toAddr ?? AUDIENCE_LABELS[r.audience]}</td>
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
      <nav className="adm-pager" aria-label="Страницы журнала">
        {page > 1 ? <Link href={link(page - 1)}>← Назад</Link> : null}
        <span>
          Страница {page} из {pages} · всего {journal.total}
        </span>
        {page < pages ? <Link href={link(page + 1)}>Вперёд →</Link> : null}
      </nav>
    </>
  );
}
