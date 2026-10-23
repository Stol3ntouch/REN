import type { Metadata } from 'next';
import { hasPermission } from '@/domain/admin/permissions';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { importOps } from '../_lib/import-ops';
import { fmtIso, INTEGRATION_NAV, int, str, SubNav } from '../_lib/ui';
import type { ImportRunRow } from '@/server/db/repositories/import-runs';

export const metadata: Metadata = { title: 'Импорт YML' };
export const dynamic = 'force-dynamic';

type RowErr = { message?: string };
const errorLines = (run: ImportRunRow): string[] => run.errors.slice(0, 50).map((e) => (e && typeof e === 'object' ? ((e as RowErr).message ?? 'ошибка') : String(e)));

function RunCounts({ run }: { run: ImportRunRow }) {
  return (
    <ul>
      <li>Категории: создать/создано {run.categoriesCreated}, обновить/обновлено {run.categoriesUpdated}</li>
      <li>
        Товары: создать/создано {run.productsCreated}, обновить/обновлено {run.productsUpdated}, без изменений {run.productsUnchanged}
      </li>
      {run.mode === 'apply' ? (
        <li>
          Фото: сохранено {run.imagesStored}, ошибок {run.imagesFailed}
        </li>
      ) : null}
      <li>Ошибок и предупреждений: {run.errorCount}</li>
    </ul>
  );
}

function Errors({ run }: { run: ImportRunRow }) {
  const lines = errorLines(run);
  if (lines.length === 0) return null;
  return (
    <>
      <h3>Ошибки (первые {lines.length})</h3>
      <ol className="ops-errors">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
    </>
  );
}

export default async function AdminImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('integrations.read');
  const sp = await searchParams;
  const canRun = hasPermission(session.role, 'integrations.run');
  const previewId = int(sp.preview, 0);
  const reportId = int(sp.report, 0);
  const preview = previewId ? importOps.getRun(session, previewId) : null;
  const report = reportId ? importOps.getRun(session, reportId) : null;
  const history = importOps.history(session);
  const error = str(sp.error);

  return (
    <>
      <h1>Импорт каталога из YML</h1>
      <SubNav items={INTEGRATION_NAV} current="/admin/import" />
      {error ? (
        <p className="adm-flash adm-flash--error" role="alert">
          {error}
        </p>
      ) : null}

      {canRun ? (
        <form action="/admin/import/upload" method="post" encType="multipart/form-data" className="adm-card">
          <h2>1. Загрузка файла</h2>
          <div className="adm-field">
            <label htmlFor="imp-file">Файл YML или XML (до 20 МБ)</label>
            <input id="imp-file" name="file" type="file" accept=".yml,.xml,text/xml,application/xml" required />
          </div>
          <p className="ops-muted">Сначала будет показан предпросмотр — в каталог ничего не запишется, пока вы не подтвердите.</p>
          <div className="adm-inline">
            <button type="submit" className="button">
              Загрузить и показать предпросмотр
            </button>
          </div>
        </form>
      ) : (
        <p className="ops-readonly">Загрузку и применение импорта выполняет администратор. Вам доступен журнал запусков.</p>
      )}

      {preview && preview.mode === 'preview' ? (
        <section className="adm-card" aria-labelledby="pv-h">
          <h2 id="pv-h">2. Предпросмотр: {preview.fileName ?? 'файл'}</h2>
          <RunCounts run={preview} />
          <Errors run={preview} />
          {canRun ? (
            <form action="/admin/import/apply" method="post">
              <input type="hidden" name="previewId" value={preview.id} />
              <button type="submit" className="button">
                Подтвердить и применить
              </button>
              <p className="ops-muted">Повторное применение того же файла безопасно: дублей не будет. Закреплённые вручную поля не перезаписываются.</p>
            </form>
          ) : null}
        </section>
      ) : null}

      {report && report.mode === 'apply' ? (
        <section className="adm-card" aria-labelledby="rp-h">
          <h2 id="rp-h">3. Отчёт: {report.fileName ?? 'файл'}</h2>
          <p className="adm-flash" role="status">
            Импорт выполнен {fmtIso(report.finishedAt)}.
          </p>
          <RunCounts run={report} />
          <Errors run={report} />
        </section>
      ) : null}

      <h2>История запусков</h2>
      {history.length === 0 ? (
        <EmptyState title="Запусков пока не было" />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Журнал импорта</caption>
            <thead>
              <tr>
                <th scope="col">№</th>
                <th scope="col">Когда</th>
                <th scope="col">Режим</th>
                <th scope="col">Файл</th>
                <th scope="col" className="num">
                  Создано
                </th>
                <th scope="col" className="num">
                  Обновлено
                </th>
                <th scope="col" className="num">
                  Без изменений
                </th>
                <th scope="col" className="num">
                  Ошибок
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{fmtIso(r.finishedAt)}</td>
                  <td>{r.mode === 'apply' ? 'применён' : 'предпросмотр'}</td>
                  <td>{r.fileName ?? '—'}</td>
                  <td className="num">{r.productsCreated}</td>
                  <td className="num">{r.productsUpdated}</td>
                  <td className="num">{r.productsUnchanged}</td>
                  <td className="num">{r.errorCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
