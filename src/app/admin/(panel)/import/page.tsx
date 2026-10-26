import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { toReportIssue } from '@/importing/issues';
import { FIELDS } from '@/importing/fields';
import { getDb } from '@/server/db/connection';
import { brandsRepo } from '@/server/db/repositories/brands';
import { categoriesRepo } from '@/server/db/repositories/categories';
import type { ImportRunRow } from '@/server/db/repositories/import-runs';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { importOps, type Analysis, type WizardState } from '../_lib/import-ops';
import { Flash, fmtIso, int, str } from '../_lib/ui';
import { applyAction, configureFileAction, mappingAction, optionsAction } from './actions';

export const metadata: Metadata = { title: 'Импорт / Экспорт' };
export const dynamic = 'force-dynamic';

const STEPS = [
  ['file', 'Файл'],
  ['mapping', 'Сопоставление'],
  ['check', 'Проверка'],
  ['preview', 'Предпросмотр'],
  ['apply', 'Применение'],
] as const;
type Step = (typeof STEPS)[number][0];

const VERDICT: Record<string, string> = { create: 'создать', update: 'обновить', skip: 'пропустить', error: 'ошибка' };
const STATUS: Record<string, string> = { uploaded: 'файл загружен', running: 'выполняется', done: 'готово', failed: 'не выполнен' };

function Stepper({ run, step, format }: { run: number; step: Step; format: string | null }) {
  return (
    <nav aria-label="Шаги импорта">
      <ol className="ops-subnav">
        {STEPS.filter(([key]) => !(format === 'yml' && key === 'mapping')).map(([key, label], i) => (
          <li key={key}>
            <Link href={`/admin/import?run=${run}&step=${key}`} aria-current={key === step ? 'step' : undefined}>
              {i + 1}. {label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function FileStep({ st }: { st: WizardState }) {
  const run = st.run;
  return (
    <section className="adm-card" aria-labelledby="st-file">
      <h2 id="st-file">1. Файл: {run.fileName}</h2>
      <p>
        Формат определён по содержимому: <strong>{run.format === 'yml' ? 'YML (каталог)' : 'CSV (таблица)'}</strong>. Строк данных: {run.rowsTotal}. Размер: {Math.ceil(run.fileSize / 1024)} КБ.
      </p>
      {st.csv ? (
        <>
          <form action={configureFileAction} className="adm-inline">
            <input type="hidden" name="run" value={run.id} />
            <div className="adm-field">
              <label htmlFor="imp-enc">Кодировка (определена: {st.csv.encoding})</label>
              <select id="imp-enc" name="encoding" defaultValue={st.settings.encoding}>
                <option value="auto">определять сама</option>
                <option value="utf-8">UTF-8</option>
                <option value="windows-1251">windows-1251</option>
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="imp-del">Разделитель (определён: {st.csv.delimiter === '\t' ? 'табуляция' : st.csv.delimiter})</label>
              <select id="imp-del" name="delimiter" defaultValue={st.settings.delimiter}>
                <option value="auto">определять сам</option>
                <option value=";">точка с запятой «;»</option>
                <option value=",">запятая «,»</option>
                <option value={'\t'}>табуляция</option>
              </select>
            </div>
            <button type="submit" className="button button--secondary">
              Прочитать заново
            </button>
          </form>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Первые строки файла</caption>
              <thead>
                <tr>
                  {st.csv.headers.map((h, i) => (
                    <th key={i} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {st.csv.sample.map((r, i) => (
                  <tr key={i}>
                    {st.csv!.headers.map((_, c) => (
                      <td key={c}>{(r[c] ?? '').slice(0, 80)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="ops-muted">YML не требует сопоставления колонок: категории, цены, характеристики и фото читаются по структуре каталога.</p>
      )}
      <p>
        <Link className="button" href={`/admin/import?run=${run.id}&step=${run.format === 'yml' ? 'check' : 'mapping'}`}>
          Далее
        </Link>
      </p>
    </section>
  );
}

function MappingStep({ st }: { st: WizardState }) {
  const csv = st.csv;
  if (!csv) return null;
  return (
    <section className="adm-card" aria-labelledby="st-map">
      <h2 id="st-map">2. Сопоставление колонок</h2>
      <p className="ops-muted">Для каждой колонки файла выберите поле системы. Характеристики — «attr:код». Неподходящие колонки оставьте без сопоставления.</p>
      <form action={mappingAction}>
        <input type="hidden" name="run" value={st.run.id} />
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Колонка файла</th>
                <th scope="col">Пример</th>
                <th scope="col">Поле системы</th>
              </tr>
            </thead>
            <tbody>
              {csv.headers.map((h, i) => (
                <tr key={i}>
                  <th scope="row">{h}</th>
                  <td>{(csv.sample[0]?.[i] ?? '').slice(0, 40)}</td>
                  <td>
                    <label className="visually-hidden" htmlFor={`col-${i}`}>
                      Поле для колонки «{h}»
                    </label>
                    <select id={`col-${i}`} name={`col-${i}`} defaultValue={st.settings.mapping[h] ?? ''}>
                      <option value="">— не импортировать —</option>
                      {FIELDS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                      {st.attributes.map((a) => (
                        <option key={a.code} value={`attr:${a.code}`}>
                          Характеристика: {a.name} (attr:{a.code})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="adm-inline">
          <div className="adm-field">
            <label htmlFor="imp-preset-name">Сохранить как пресет</label>
            <input id="imp-preset-name" name="presetName" maxLength={80} placeholder="Например, прайс поставщика" />
          </div>
          <button type="submit" name="intent" value="save" className="button">
            Сохранить сопоставление
          </button>
          <button type="submit" name="intent" value="preset-save" className="button button--secondary">
            Сохранить и запомнить пресет
          </button>
          <button type="submit" name="intent" value="auto" className="button button--secondary">
            Подобрать по заголовкам
          </button>
        </div>
        {st.presets.length > 0 ? (
          <div className="adm-inline">
            <div className="adm-field">
              <label htmlFor="imp-preset">Сохранённые пресеты</label>
              <select id="imp-preset" name="preset">
                {st.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" name="intent" value="preset-apply" className="button button--secondary">
              Применить пресет
            </button>
            <button type="submit" name="intent" value="preset-delete" className="button button--secondary">
              Удалить пресет
            </button>
          </div>
        ) : null}
      </form>
      <p>
        <Link className="button" href={`/admin/import?run=${st.run.id}&step=check`}>
          Далее: проверка
        </Link>
      </p>
    </section>
  );
}

function Summary({ a }: { a: Analysis }) {
  const s = a.summary;
  return (
    <ul>
      <li>Создать: {s.create}</li>
      <li>Обновить: {s.update}</li>
      <li>Пропустить: {s.skip}</li>
      <li>Ошибок: {s.error}</li>
      {s.lockedSkipped > 0 ? <li>Полей, закреплённых вручную и не изменяемых: {s.lockedSkipped}</li> : null}
      {s.categoriesToCreate > 0 ? <li>Будет создано категорий: {s.categoriesToCreate}</li> : null}
      {s.brandsToCreate > 0 ? <li>Будет создано брендов: {s.brandsToCreate}</li> : null}
    </ul>
  );
}

function CheckStep({ st, a }: { st: WizardState; a: Analysis }) {
  const o = st.settings.import;
  return (
    <section className="adm-card" aria-labelledby="st-check">
      <h2 id="st-check">3. Проверка</h2>
      <form action={optionsAction}>
        <input type="hidden" name="run" value={st.run.id} />
        <div className="adm-inline">
          <div className="adm-field">
            <label htmlFor="o-mode">Режим</label>
            <select id="o-mode" name="mode" defaultValue={o.mode}>
              <option value="update">обновить существующие</option>
              <option value="create_only">только новые</option>
            </select>
          </div>
          {st.run.format === 'csv' ? (
            <div className="adm-field">
              <label htmlFor="o-key">Ключ поиска товара</label>
              <select id="o-key" name="key" defaultValue={o.key}>
                <option value="sku">артикул</option>
                <option value="external_id">внешний ID</option>
                <option value="barcode">штрихкод</option>
              </select>
            </div>
          ) : null}
          <div className="adm-field">
            <label htmlFor="o-tr">Применение</label>
            <select id="o-tr" name="transaction" defaultValue={o.transaction}>
              <option value="batch">пакетами (ошибочные строки пропускаются)</option>
              <option value="atomic">всё или ничего (до 5000 строк)</option>
            </select>
          </div>
          {st.run.format === 'csv' ? (
            <div className="adm-field">
              <label htmlFor="o-unknown">Неизвестные категории и бренды</label>
              <select id="o-unknown" name="unknownRefs" defaultValue={o.unknownRefs}>
                <option value="error">ошибка строки</option>
                <option value="create">создавать</option>
              </select>
            </div>
          ) : null}
        </div>
        {st.run.format === 'csv' ? (
          <>
            <label>
              <input type="checkbox" name="createMissing" defaultChecked={o.createMissing} /> создавать товары, которых нет в базе (режим «обновить»)
            </label>
            <br />
            <label>
              <input type="checkbox" name="clearEmpty" defaultChecked={o.clearEmpty} /> очищать значения пустыми ячейками (иначе пустые ячейки ничего не затирают)
            </label>
            <br />
          </>
        ) : null}
        <label>
          <input type="checkbox" name="overrideLocked" defaultChecked={o.overrideLocked} /> перезаписывать ручные правки (закреплённые поля)
        </label>
        <br />
        <label>
          <input type="checkbox" name="downloadImages" defaultChecked={o.downloadImages} /> скачивать фото по ссылкам (только разрешённые хосты)
        </label>
        <p>
          <button type="submit" className="button button--secondary">
            Пересчитать проверку
          </button>
        </p>
      </form>
      <h3>Итог проверки</h3>
      <Summary a={a} />
      {a.blockers.length > 0 ? (
        <ul className="ops-errors" role="alert">
          {a.blockers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
      {a.issues.length > 0 ? (
        <>
          <h3>
            Ошибки по строкам (первые {a.issues.length} из {a.issueCount})
          </h3>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Строка</th>
                  <th scope="col">Поле</th>
                  <th scope="col">Причина</th>
                </tr>
              </thead>
              <tbody>
                {a.issues.map((e, i) => (
                  <tr key={i}>
                    <td>{e.row ?? '—'}</td>
                    <td>{e.field || '—'}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="adm-flash" role="status">
          Ошибок не найдено.
        </p>
      )}
      <p>
        <Link className="button" href={`/admin/import?run=${st.run.id}&step=preview`}>
          Далее: предпросмотр
        </Link>
      </p>
    </section>
  );
}

function PreviewStep({ st, a }: { st: WizardState; a: Analysis }) {
  return (
    <section className="adm-card" aria-labelledby="st-prev">
      <h2 id="st-prev">4. Предпросмотр (первые {a.preview.length} строк)</h2>
      <Summary a={a} />
      <div className="adm-table-wrap">
        <table className="adm-table">
          <caption className="visually-hidden">Предпросмотр импорта</caption>
          <thead>
            <tr>
              <th scope="col">Строка</th>
              <th scope="col">Что будет</th>
              <th scope="col">Ключ</th>
              <th scope="col">Название</th>
              <th scope="col">Изменения / причина</th>
            </tr>
          </thead>
          <tbody>
            {a.preview.map((r, i) => (
              <tr key={i}>
                <td>{r.rowNo ?? '—'}</td>
                <td>{VERDICT[r.verdict]}</td>
                <td>{r.key ?? '—'}</td>
                <td>{r.name ?? '—'}</td>
                <td>
                  {r.changes.length > 0 ? r.changes.join(', ') : (r.reason ?? '')}
                  {r.lockedSkipped.length > 0 ? ` · закреплено вручную: ${r.lockedSkipped.join(', ')}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <Link className="button button--secondary" href={`/admin/import?run=${st.run.id}&step=apply`}>
          Далее: применение
        </Link>
      </p>
    </section>
  );
}

function ApplyStep({ st, a }: { st: WizardState; a: Analysis }) {
  const o = st.settings.import;
  return (
    <section className="adm-card" aria-labelledby="st-apply">
      <h2 id="st-apply">5. Применение</h2>
      <Summary a={a} />
      {a.blockers.length > 0 ? (
        <ul className="ops-errors" role="alert">
          {a.blockers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
      <form action={applyAction}>
        <input type="hidden" name="run" value={st.run.id} />
        {o.overrideLocked ? (
          <label>
            <input type="checkbox" name="confirmOverride" /> подтверждаю: значения, правленные вручную, будут перезаписаны данными файла
          </label>
        ) : null}
        <p className="ops-muted">Повторное применение того же файла безопасно: дублей не будет. Импорт идёт пакетами по 500 строк, ход виден на этой странице.</p>
        <button type="submit" className="button" disabled={a.blockers.length > 0}>
          Применить
        </button>
      </form>
    </section>
  );
}

function RunReport({ run }: { run: ImportRunRow }) {
  const running = run.status === 'running';
  const pct = run.rowsTotal > 0 ? Math.min(100, Math.round((run.progress / run.rowsTotal) * 100)) : 0;
  return (
    <section className="adm-card" aria-labelledby="rp-h">
      {running ? <meta httpEquiv="refresh" content="2" /> : null}
      <h2 id="rp-h">
        Отчёт №{run.id}: {run.fileName ?? 'файл'} — {STATUS[run.status] ?? run.status}
      </h2>
      {running ? (
        <p role="status">
          <progress max={100} value={pct} aria-label="Ход импорта" /> {run.progress} из {run.rowsTotal} строк ({pct}%). Страница обновляется сама.
        </p>
      ) : null}
      <ul>
        <li>Создано: {run.productsCreated}</li>
        <li>Обновлено: {run.productsUpdated}</li>
        <li>Пропущено / без изменений: {run.productsUnchanged}</li>
        {run.categoriesCreated > 0 ? <li>Создано категорий: {run.categoriesCreated}</li> : null}
        {run.imagesStored + run.imagesFailed > 0 ? (
          <li>
            Фото: сохранено {run.imagesStored}, ошибок {run.imagesFailed}
          </li>
        ) : null}
        <li>Ошибок и предупреждений: {run.errorCount}</li>
      </ul>
      {run.errors.length > 0 ? (
        <>
          <h3>Ошибки по строкам (первые {Math.min(run.errors.length, 100)})</h3>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Строка</th>
                  <th scope="col">Поле</th>
                  <th scope="col">Причина</th>
                </tr>
              </thead>
              <tbody>
                {run.errors.slice(0, 100).map((e, i) => {
                  const x = toReportIssue(e);
                  return (
                    <tr key={i}>
                      <td>{x.row ?? '—'}</td>
                      <td>{x.field || '—'}</td>
                      <td>{x.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            <a className="button button--secondary" href={`/admin/api/import/errors?run=${run.id}`}>
              Скачать ошибки (CSV)
            </a>
          </p>
        </>
      ) : null}
    </section>
  );
}

export default async function AdminImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('integrations.read');
  const sp = await searchParams;
  const canRun = hasPermission(session, 'import.run');
  const canExport = hasPermission(session, 'export.run');
  const runId = int(sp.run, 0);
  const error = str(sp.error);
  const history = importOps.history(session);
  const run = runId ? importOps.getRun(session, runId) : null;

  let wizard: { st: WizardState; step: Step } | null = null;
  let analysis: Analysis | null = null;
  let wizardError = '';
  if (run && run.kind === 'import' && run.status === 'uploaded' && canRun) {
    try {
      const st = importOps.state(session, run.id);
      const asked = str(sp.step) as Step;
      const step: Step = STEPS.some(([k]) => k === asked) ? asked : 'file';
      wizard = { st, step };
      if (step === 'check' || step === 'preview' || step === 'apply') analysis = importOps.analyze(session, run.id);
    } catch (e) {
      wizardError = e instanceof Error ? e.message : 'Не удалось прочитать файл';
    }
  }
  const categories = canExport ? categoriesRepo.listAll(getDb()) : [];
  const brands = canExport ? brandsRepo.listAll(getDb()) : [];

  return (
    <>
      <h1>Импорт / Экспорт</h1>
      <Flash ok={str(sp.ok)} error={error || wizardError} okText="Сохранено." />

      {canRun && !wizard ? (
        <form action="/admin/api/import/upload" method="post" encType="multipart/form-data" className="adm-card">
          <h2>Загрузка файла</h2>
          <div className="adm-field">
            <label htmlFor="imp-file">Файл CSV или YML (до 20 МБ, до 50 000 строк)</label>
            <input id="imp-file" name="file" type="file" accept=".csv,.txt,.yml,.xml,text/csv,text/xml,application/xml" required />
          </div>
          <p className="ops-muted">Формат определяется по содержимому. Сначала будет проверка и предпросмотр — в каталог ничего не запишется, пока вы не подтвердите.</p>
          <button type="submit" className="button">
            Загрузить
          </button>
        </form>
      ) : null}
      {!canRun ? <p className="ops-readonly">Загрузку и применение импорта выполняет администратор. Вам доступна история запусков.</p> : null}

      {wizard ? (
        <>
          <Stepper run={wizard.st.run.id} step={wizard.step} format={wizard.st.run.format} />
          {wizard.step === 'file' ? <FileStep st={wizard.st} /> : null}
          {wizard.step === 'mapping' ? <MappingStep st={wizard.st} /> : null}
          {wizard.step === 'check' && analysis ? <CheckStep st={wizard.st} a={analysis} /> : null}
          {wizard.step === 'preview' && analysis ? <PreviewStep st={wizard.st} a={analysis} /> : null}
          {wizard.step === 'apply' && analysis ? <ApplyStep st={wizard.st} a={analysis} /> : null}
        </>
      ) : null}

      {run && run.kind === 'import' && run.status !== 'uploaded' ? <RunReport run={run} /> : null}

      {canExport ? (
        <form action="/admin/api/import/export" method="get" className="adm-card" aria-labelledby="ex-h">
          <h2 id="ex-h">Экспорт товаров в CSV</h2>
          <p className="ops-muted">Выгрузка каталога по фильтрам (UTF-8, разделитель «;»). Это не резервная копия базы данных — копии делаются в разделе «Резервные копии». Закупочная цена выгружается только при праве на её просмотр.</p>
          <div className="adm-inline">
            <div className="adm-field">
              <label htmlFor="ex-q">Поиск</label>
              <input id="ex-q" name="q" maxLength={100} />
            </div>
            <div className="adm-field">
              <label htmlFor="ex-cat">Категория</label>
              <select id="ex-cat" name="category" defaultValue="">
                <option value="">все</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="ex-brand">Бренд</label>
              <select id="ex-brand" name="brand" defaultValue="">
                <option value="">все</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="ex-av">Наличие</label>
              <select id="ex-av" name="availability" defaultValue="">
                <option value="">любое</option>
                <option value="in_stock">в наличии</option>
                <option value="out_of_stock">нет в наличии</option>
                <option value="preorder">под заказ</option>
                <option value="discontinued">снят с продажи</option>
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="ex-pub">Публикация</label>
              <select id="ex-pub" name="published" defaultValue="">
                <option value="">любая</option>
                <option value="1">опубликованные</option>
                <option value="0">снятые</option>
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="ex-min">Цена от, ₽</label>
              <input id="ex-min" name="priceMin" inputMode="decimal" />
            </div>
            <div className="adm-field">
              <label htmlFor="ex-max">Цена до, ₽</label>
              <input id="ex-max" name="priceMax" inputMode="decimal" />
            </div>
          </div>
          <button type="submit" className="button">
            Скачать CSV
          </button>
        </form>
      ) : null}

      <h2>История запусков</h2>
      {history.length === 0 ? (
        <EmptyState title="Запусков пока не было" />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Журнал импорта и экспорта</caption>
            <thead>
              <tr>
                <th scope="col">№</th>
                <th scope="col">Когда</th>
                <th scope="col">Тип</th>
                <th scope="col">Формат</th>
                <th scope="col">Файл</th>
                <th scope="col">Состояние</th>
                <th scope="col" className="num">
                  Создано
                </th>
                <th scope="col" className="num">
                  Обновлено
                </th>
                <th scope="col" className="num">
                  Ошибок
                </th>
                <th scope="col">Отчёт</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{fmtIso(r.finishedAt)}</td>
                  <td>{r.kind === 'export' ? 'экспорт' : r.mode === 'apply' ? 'импорт' : 'предпросмотр'}</td>
                  <td>{r.format ?? 'yml'}</td>
                  <td>{r.fileName ?? '—'}</td>
                  <td>{r.kind === 'export' ? `${r.rowsTotal} строк` : (STATUS[r.status] ?? r.status)}</td>
                  <td className="num">{r.productsCreated}</td>
                  <td className="num">{r.productsUpdated}</td>
                  <td className="num">{r.errorCount}</td>
                  <td>{r.kind === 'import' ? <Link href={`/admin/import?run=${r.id}`}>открыть</Link> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
