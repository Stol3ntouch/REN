import type { Metadata } from 'next';
import Link from 'next/link';
import { backupAdmin } from '@/domain/admin/backup';
import { hasPermission } from '@/domain/admin/permissions';
import type { BackupStatus } from '@/server/db/repositories/backups';
import { requireStaffPage } from '@/ui/admin/guard';
import { PageHeader } from '@/ui/admin/kit';
import { EmptyState } from '@/ui/states';
import { Flash, fmtTime, int, str } from '../../_lib/ui';
import { SettingsTabs } from '../SettingsTabs';
import { cancelRestoreAction, startBackupAction, verifyBackupAction } from './actions';
import { AutoRefresh, DownloadForm, RestoreForm } from './BackupClient';

export const metadata: Metadata = { title: 'Резервные копии' };
export const dynamic = 'force-dynamic';

const STATUS: Record<BackupStatus, { text: string; cls: string }> = {
  queued: { text: 'в очереди', cls: 'ops-badge--warn' },
  running: { text: 'выполняется', cls: 'ops-badge--warn' },
  ok: { text: 'готово', cls: 'ops-badge--ok' },
  error: { text: 'ошибка', cls: 'ops-badge--error' },
};
const PAGE = 20;
const size = (b: number | null): string => (b === null ? '—' : b >= 1_048_576 ? `${Math.round((b / 1_048_576) * 10) / 10} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);

export default async function BackupSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('backup.run');
  const sp = await searchParams;
  const page = int(sp.page, 1);
  const view = backupAdmin.list(session, { limit: PAGE, offset: (page - 1) * PAGE });
  const pages = Math.max(1, Math.ceil(view.total / PAGE));
  const canRestore = hasPermission(session, 'settings.write');
  return (
    <>
      <PageHeader title="Настройки магазина" description="Резервные копии базы данных" />
      <SettingsTabs current="backup" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Готово." />
      <AutoRefresh active={view.running !== null} />

      <section className="adm-card" aria-labelledby="bk-what">
        <h2 id="bk-what">Что это</h2>
        <p>
          Резервная копия — это снимок <strong>базы данных</strong> (заказы, клиенты, сотрудники, настройки, каталог) и загруженных файлов, с контрольными суммами.
        </p>
        <p>
          Экспорт товаров из раздела «Импорт / Экспорт» не является резервной копией: в нём нет заказов, клиентов и настроек, и магазин из него не восстановить.
        </p>
        <p className="ops-muted">
          В копию не входят .env и секреты (ключи, пароли) — храните их отдельно. В копии есть персональные данные покупателей: скачанный файл храните так же бережно, как саму базу.
        </p>
        <form action={startBackupAction}>
          <button type="submit" className="button" disabled={view.running !== null}>
            Создать копию
          </button>
        </form>
      </section>

      {view.pending ? (
        <section className="adm-card" aria-labelledby="bk-pending" role="status">
          <h2 id="bk-pending">Восстановление запрошено</h2>
          <p>
            Запрошено {fmtTime(view.pending.requestedAt)}. Данные будут заменены при следующем запуске приложения (перезапустите сервер) — либо остановите сервер и выполните <code>npm run restore -- --pending</code>.
            Прежнее состояние сохранится в папке data/pre-restore-*.
          </p>
          {canRestore ? (
            <form action={cancelRestoreAction}>
              <button type="submit" className="button button--outline">
                Отменить запрос
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      <h2>История копий</h2>
      {view.rows.length === 0 ? (
        <EmptyState title="Копий пока нет">Нажмите «Создать копию». Первую копию стоит проверить кнопкой «Проверить».</EmptyState>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Резервные копии</caption>
            <thead>
              <tr>
                <th scope="col">Создана</th>
                <th scope="col">Вид</th>
                <th scope="col">Автор</th>
                <th scope="col">Статус</th>
                <th scope="col">Файл</th>
                <th scope="col">Размер</th>
                <th scope="col">SHA-256</th>
                <th scope="col">Проверка</th>
                <th scope="col">Действия</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((b) => (
                <tr key={b.id}>
                  <td>{fmtTime(b.createdAt)}</td>
                  <td>{b.kind === 'pre_restore' ? 'до восстановления' : 'вручную'}</td>
                  <td>{b.createdByName ?? '—'}</td>
                  <td>
                    <span className={`ops-badge ${STATUS[b.status].cls}`}>{STATUS[b.status].text}</span>
                    {b.status === 'running' || b.status === 'queued' ? <progress value={b.progress} max={100} aria-label="Ход создания копии" /> : null}
                    {b.error ? <div className="ops-muted">{b.error}</div> : null}
                  </td>
                  <td>{b.fileName ?? '—'}</td>
                  <td>{size(b.sizeBytes)}</td>
                  <td>
                    <code title={b.sha256 ?? ''}>{b.sha256 ? `${b.sha256.slice(0, 12)}…` : '—'}</code>
                  </td>
                  <td>
                    {b.verifyOk === null ? (
                      'не проверялась'
                    ) : (
                      <>
                        <span className={`ops-badge ${b.verifyOk ? 'ops-badge--ok' : 'ops-badge--error'}`}>{b.verifyOk ? 'цела' : 'повреждена'}</span> {fmtTime(b.verifiedAt)}
                        <div className="ops-muted">{b.verifyMessage}</div>
                      </>
                    )}
                  </td>
                  <td>
                    {b.status === 'ok' ? (
                      <div className="adm-inline">
                        <form action={verifyBackupAction}>
                          <input type="hidden" name="id" value={b.id} />
                          <button type="submit" className="button button--outline button--small">
                            Проверить
                          </button>
                        </form>
                        <DownloadForm id={b.id} />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="adm-pager" aria-label="Страницы">
        {page > 1 ? <Link href={`/admin/settings/backup?page=${page - 1}`}>← Назад</Link> : null}
        <span>
          Страница {page} из {pages}
        </span>
        {page < pages ? <Link href={`/admin/settings/backup?page=${page + 1}`}>Вперёд →</Link> : null}
      </nav>

      {canRestore ? (
        <section className="adm-card" aria-labelledby="bk-restore">
          <h2 id="bk-restore">Восстановить из копии</h2>
          <p className="ops-muted">Нужны права «Резервные копии» и «Изменение настроек магазина». Выберите копию со статусом «готово».</p>
          {view.rows
            .filter((b) => b.status === 'ok' && b.kind === 'manual')
            .slice(0, 10)
            .map((b) => (
              <details key={b.id} className="adm-card">
                <summary>
                  Копия от {fmtTime(b.createdAt)} ({b.fileName})
                </summary>
                <RestoreForm id={b.id} name={fmtTime(b.createdAt)} />
              </details>
            ))}
        </section>
      ) : null}
    </>
  );
}
