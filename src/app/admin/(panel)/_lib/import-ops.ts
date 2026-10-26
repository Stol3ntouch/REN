import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { audit } from '@/domain/admin/audit';
import { notify } from '@/domain/admin/notifications';
import { hasPermission, requirePermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { filterOf, type ProductFilter } from '@/domain/catalog/products-list';
import { decodeBytes, type EncodingChoice, type TextEncodingName } from '@/importing/encoding';
import { exportProductsCsv } from '@/importing/export';
import { autoMap, validateMapping, type Mapping } from '@/importing/fields';
import type { ImageDownloadOptions } from '@/importing/images';
import { issuesToCsv, toReportIssue } from '@/importing/issues';
import { ATOMIC_MAX_ROWS, MAX_IMPORT_BYTES, PREVIEW_ROWS } from '@/importing/limits';
import { importOptionsSchema, parseOptions, type ImportOptions } from '@/importing/options';
import { applyRows } from '@/importing/products/apply';
import { planRows, fieldLabel, type CsvPlan, type Verdict } from '@/importing/products/plan';
import { parseRows } from '@/importing/rows';
import type { Delimiter } from '@/importing/csv';
import { readCsvTable, sniffFile } from '@/importing/table';
import { applyImport, ImportFileError, parseYml, planImport } from '@/importing/yml';
import { getConfig } from '@/server/config';
import { getDb, type Db } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { importMappingsRepo, type ImportMappingRow } from '@/server/db/repositories/import-mappings';
import { importRunsRepo, type ImportRunRow } from '@/server/db/repositories/import-runs';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number; /** Каталог служебных копий загруженных файлов (по умолчанию DATA_DIR/import-staging). */ stagingDir?: string; images?: ImageDownloadOptions };

/** Срок, после которого запуск в состоянии «выполняется» считается оборвавшимся (перезапуск сервера). */
const STALE_RUN_MS = 30 * 60 * 1000;

const stagingDirOf = (o: Opts): string => o.stagingDir ?? join(getConfig().dataDir, 'import-staging');
const stagedPath = (o: Opts, runId: number): string => join(stagingDirOf(o), `run-${runId}.dat`);
const nowOf = (o: Opts): number => o.now ?? Date.now();
const iso = (ms: number): string => new Date(ms).toISOString();

function requireAny(session: StaffSession | null | undefined, perms: readonly Permission[]): asserts session is StaffSession {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!perms.some((p) => hasPermission(session, p))) throw new ForbiddenError('Недостаточно прав для этого действия');
}

/** Настройки мастера, лежащие в import_runs.options. */
export type WizardSettings = {
  encoding: EncodingChoice;
  delimiter: Delimiter | 'auto';
  mapping: Mapping;
  import: ImportOptions;
};

function settingsOf(run: ImportRunRow): WizardSettings {
  const o = run.options as Partial<WizardSettings>;
  const delimiters = [';', ',', '\t', 'auto'];
  return {
    encoding: o.encoding === 'utf-8' || o.encoding === 'windows-1251' ? o.encoding : 'auto',
    delimiter: typeof o.delimiter === 'string' && delimiters.includes(o.delimiter) ? (o.delimiter as Delimiter | 'auto') : 'auto',
    mapping: o.mapping && typeof o.mapping === 'object' ? (o.mapping as Mapping) : {},
    import: parseOptions(o.import),
  };
}

const verdictOfAction = (a: 'create' | 'update' | 'unchanged'): Verdict => (a === 'unchanged' ? 'skip' : a);

export type PreviewRow = { rowNo: number | null; verdict: Verdict; name: string | null; key: string | null; reason: string | null; changes: string[]; lockedSkipped: string[] };

export type Analysis = {
  format: 'csv' | 'yml';
  summary: { total: number; create: number; update: number; skip: number; error: number; lockedSkipped: number; categoriesToCreate: number; brandsToCreate: number };
  preview: PreviewRow[];
  issues: { row: number | null; field: string; message: string }[];
  issueCount: number;
  /** Что мешает применить (сопоставление, ключ, лимиты). */
  blockers: string[];
};

export type WizardState = {
  run: ImportRunRow;
  settings: WizardSettings;
  csv: { encoding: TextEncodingName; delimiter: Delimiter; headers: string[]; sample: string[][]; rowCount: number } | null;
  presets: ImportMappingRow[];
  attributes: { code: string; name: string }[];
};

export type ApplyHandle = { runId: number; done: Promise<void> };

function loadRun(db: Db, runId: number): ImportRunRow {
  const run = Number.isInteger(runId) ? importRunsRepo.get(db, runId) : undefined;
  if (!run || run.kind !== 'import') throw new NotFoundError('Запуск не найден — загрузите файл заново');
  return run;
}

function loadStaged(o: Opts, run: ImportRunRow): Uint8Array {
  if (run.status !== 'uploaded' || run.mode !== 'preview' || !run.format) throw new ConflictError('Этот файл уже обработан — загрузите его заново');
  try {
    return new Uint8Array(readFileSync(stagedPath(o, run.id)));
  } catch {
    throw new NotFoundError('Загруженный файл устарел — загрузите его заново');
  }
}

function fileError(e: unknown): never {
  if (e instanceof ImportFileError) throw new ValidationError(e.message, { file: [e.message] });
  throw e;
}

function csvOf(bytes: Uint8Array, s: WizardSettings) {
  try {
    return readCsvTable(bytes, { encoding: s.encoding, delimiter: s.delimiter });
  } catch (e) {
    return fileError(e);
  }
}

const attrList = (db: Db) => attributesRepo.listAll(db).map((a) => ({ code: a.code, name: a.name }));

/**
 * Мастер импорта/экспорта. Все шаги привязаны к записи import_runs: файл → сопоставление → проверка → предпросмотр → применение.
 * Служебная копия файла называется run-<id>.dat (имя из загрузки в путь не попадает). Права: import.run — работа с мастером,
 * история и отчёты — ещё и integrations.read (менеджер), выгрузка — export.run.
 */
export const importOps = {
  /** Шаг «Файл»: проверка размера, формата (по содержимому), разбор заголовков; запись в журнал и служебная копия. */
  upload(session: StaffSession | null, file: { fileName: string; content: Uint8Array }, opts: Opts = {}): { runId: number; format: 'csv' | 'yml'; rows: number } {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const fileName = file.fileName.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'file';
    if (file.content.byteLength === 0) throw new ValidationError('Файл пустой', { file: ['Файл пустой'] });
    if (file.content.byteLength > MAX_IMPORT_BYTES) throw new ValidationError('Файл больше 20 МБ', { file: ['Файл больше 20 МБ'] });

    let format: 'csv' | 'yml';
    let rows = 0;
    const settings: WizardSettings = { encoding: 'auto', delimiter: 'auto', mapping: {}, import: parseOptions({}) };
    try {
      const sniff = sniffFile(file.content);
      format = sniff.format;
      if (format === 'csv') {
        const t = readCsvTable(file.content);
        rows = t.rows.length;
        settings.mapping = autoMap(t.headers, attrList(db));
      } else {
        const parsed = parseYml(sniff.text);
        rows = parsed.offers.length;
      }
    } catch (e) {
      return fileError(e);
    }

    const now = nowOf(opts);
    const runId = importRunsRepo.insert(db, {
      fileName,
      mode: 'preview',
      actorId: session.staffId,
      startedAt: iso(now),
      finishedAt: null,
      categoriesCreated: 0,
      categoriesUpdated: 0,
      productsCreated: 0,
      productsUpdated: 0,
      productsUnchanged: 0,
      imagesStored: 0,
      imagesFailed: 0,
      errors: [],
      format,
      status: 'uploaded',
      rowsTotal: rows,
      fileSize: file.content.byteLength,
      options: settings,
    });
    mkdirSync(stagingDirOf(opts), { recursive: true });
    writeFileSync(stagedPath(opts, runId), file.content);
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'import.run', entity: 'import', entityId: runId, after: { fileName, format, size: file.content.byteLength, rows } }, { db, now });
    return { runId, format, rows };
  },

  /** Состояние мастера для страницы. */
  state(session: StaffSession | null, runId: number, opts: Opts = {}): WizardState {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const run = loadRun(db, runId);
    const settings = settingsOf(run);
    let csv: WizardState['csv'] = null;
    if (run.format === 'csv' && run.status === 'uploaded') {
      const t = csvOf(loadStaged(opts, run), settings);
      csv = { encoding: t.encoding, delimiter: t.delimiter, headers: t.headers, sample: t.rows.slice(0, 5), rowCount: t.rows.length };
    }
    return { run, settings, csv, presets: importMappingsRepo.list(db), attributes: attrList(db) };
  },

  /** Поправить кодировку и разделитель вручную. Сопоставление подбирается заново. */
  configureFile(session: StaffSession | null, runId: number, input: { encoding?: string; delimiter?: string }, opts: Opts = {}): void {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const run = loadRun(db, runId);
    const bytes = loadStaged(opts, run);
    const s = settingsOf(run);
    const enc = input.encoding === 'utf-8' || input.encoding === 'windows-1251' ? input.encoding : 'auto';
    const del = input.delimiter === ';' || input.delimiter === ',' || input.delimiter === '\t' ? input.delimiter : 'auto';
    const next: WizardSettings = { ...s, encoding: enc, delimiter: del };
    const t = csvOf(bytes, next);
    next.mapping = autoMap(t.headers, attrList(db));
    importRunsRepo.update(db, run.id, { options: next, rowsTotal: t.rows.length });
  },

  /** Шаг «Сопоставление»: fields[i] — поле системы для колонки i ('' — не импортировать). */
  saveMapping(session: StaffSession | null, runId: number, fields: readonly string[], opts: Opts = {}): string[] {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const run = loadRun(db, runId);
    const s = settingsOf(run);
    const t = csvOf(loadStaged(opts, run), s);
    const mapping: Mapping = {};
    t.headers.forEach((h, i) => {
      if (h in mapping && mapping[h] !== '') return;
      mapping[h] = (fields[i] ?? '').trim();
    });
    const problems = validateMapping(t.headers, mapping, new Set(attrList(db).map((a) => a.code)));
    if (problems.length > 0) throw new ValidationError(problems[0]!, { mapping: problems });
    importRunsRepo.update(db, run.id, { options: { ...s, mapping } });
    return problems;
  },

  /** Автоподбор по заголовкам заново. */
  resetMapping(session: StaffSession | null, runId: number, opts: Opts = {}): void {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const run = loadRun(db, runId);
    const s = settingsOf(run);
    const t = csvOf(loadStaged(opts, run), s);
    importRunsRepo.update(db, run.id, { options: { ...s, mapping: autoMap(t.headers, attrList(db)) } });
  },

  savePreset(session: StaffSession | null, runId: number, name: string, opts: Opts = {}): number {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const clean = name.trim();
    if (clean === '' || clean.length > 80) throw new ValidationError('Название пресета: от 1 до 80 символов', { name: ['Укажите название пресета'] });
    const run = loadRun(db, runId);
    const mapping = Object.fromEntries(Object.entries(settingsOf(run).mapping).filter(([, f]) => f !== ''));
    const id = importMappingsRepo.save(db, clean, mapping, session.staffId, iso(nowOf(opts)));
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'import.preset', entity: 'import_mapping', entityId: id, after: { name: clean, fields: Object.keys(mapping).length } }, { db, now: nowOf(opts) });
    return id;
  },

  applyPreset(session: StaffSession | null, runId: number, presetId: number, opts: Opts = {}): void {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const run = loadRun(db, runId);
    const preset = Number.isInteger(presetId) ? importMappingsRepo.get(db, presetId) : undefined;
    if (!preset) throw new NotFoundError('Пресет не найден');
    const s = settingsOf(run);
    const t = csvOf(loadStaged(opts, run), s);
    const known = new Set(attrList(db).map((a) => a.code));
    const used = new Set<string>();
    const mapping: Mapping = {};
    for (const h of t.headers) {
      const f = preset.mapping[h] ?? '';
      const ok = f !== '' && !used.has(f) && validateMapping([h], { [h]: f }, known).length === 0;
      mapping[h] = ok ? f : '';
      if (ok) used.add(f);
    }
    importRunsRepo.update(db, run.id, { options: { ...s, mapping } });
  },

  deletePreset(session: StaffSession | null, presetId: number, opts: Opts = {}): void {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    if (!importMappingsRepo.delete(db, presetId)) throw new NotFoundError('Пресет не найден');
  },

  /** Режим, ключ, флажки. Неверные значения отвергаются. */
  setOptions(session: StaffSession | null, runId: number, raw: unknown, opts: Opts = {}): ImportOptions {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const run = loadRun(db, runId);
    const parsed = importOptionsSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError('Параметры импорта указаны неверно', { options: [parsed.error.issues[0]?.message ?? 'неверно'] });
    importRunsRepo.update(db, run.id, { options: { ...settingsOf(run), import: parsed.data } });
    return parsed.data;
  },

  /** Шаги «Проверка» и «Предпросмотр»: вердикт по каждой строке, итоги, ошибки. В каталог ничего не пишет. */
  analyze(session: StaffSession | null, runId: number, opts: Opts = {}): Analysis {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const run = loadRun(db, runId);
    const bytes = loadStaged(opts, run);
    const s = settingsOf(run);
    const blockers: string[] = [];

    if (run.format === 'yml') {
      let plan;
      try {
        plan = planImport(parseYml(decodeBytes(bytes).text), db, { fileName: run.fileName, mode: s.import.mode, overrideLocked: s.import.overrideLocked, now: new Date(nowOf(opts)) });
      } catch (e) {
        return fileError(e);
      }
      const preview: PreviewRow[] = plan.products.slice(0, PREVIEW_ROWS).map((p) => ({
        rowNo: p.data.position,
        verdict: verdictOfAction(p.action),
        name: p.name,
        key: p.externalId,
        reason: p.action === 'unchanged' ? 'Без изменений' : null,
        changes: p.changes,
        lockedSkipped: p.lockedSkipped,
      }));
      const issues = plan.errors.map(toReportIssue);
      if (s.import.transaction === 'atomic') {
        if (plan.products.length > ATOMIC_MAX_ROWS) blockers.push(`В режиме «всё или ничего» не больше ${ATOMIC_MAX_ROWS} строк, в файле ${plan.products.length}`);
        if (plan.errors.some((e) => e.kind === 'offer' || e.kind === 'category')) blockers.push('В режиме «всё или ничего» файл с ошибками не применяется: исправьте их или выберите пакетный режим');
      }
      const c = (a: 'create' | 'update' | 'unchanged') => plan.products.filter((p) => p.action === a).length;
      return {
        format: 'yml',
        summary: {
          total: plan.products.length + plan.errors.filter((e) => e.kind === 'offer').length,
          create: c('create'),
          update: c('update'),
          skip: c('unchanged'),
          error: plan.errors.filter((e) => e.kind === 'offer' || e.kind === 'category').length,
          lockedSkipped: plan.products.reduce((n, p) => n + p.lockedSkipped.length, 0),
          categoriesToCreate: plan.summary.categories.create,
          brandsToCreate: 0,
        },
        preview,
        issues: issues.slice(0, 200),
        issueCount: issues.length,
        blockers,
      };
    }

    const t = csvOf(bytes, s);
    const known = new Set(attrList(db).map((a) => a.code));
    blockers.push(...validateMapping(t.headers, s.mapping, known));
    const mapped = new Set(Object.values(s.mapping).filter(Boolean));
    const keyField = s.import.key === 'sku' ? 'sku' : s.import.key === 'external_id' ? 'externalId' : 'barcode';
    if (s.import.mode === 'update' && !mapped.has(keyField)) blockers.push(`Для режима «обновить» сопоставьте колонку с полем «${fieldLabel(keyField)}» (ключ) или выберите другой ключ`);
    if (s.import.mode === 'create_only' && !mapped.has('sku') && !mapped.has('externalId')) blockers.push('Сопоставьте колонку «Артикул» или «Внешний ID» — по ним находятся уже существующие товары');
    if (t.rows.length === 0) blockers.push('В файле нет строк данных');
    const plan = planRows(db, parseRows(t.headers, t.rows, s.mapping), s.import);
    if (s.import.transaction === 'atomic') {
      if (plan.rows.length > ATOMIC_MAX_ROWS) blockers.push(`В режиме «всё или ничего» не больше ${ATOMIC_MAX_ROWS} строк, в файле ${plan.rows.length}`);
      if (plan.summary.error > 0) blockers.push(`В режиме «всё или ничего» файл с ошибками не применяется (ошибок: ${plan.summary.error}): исправьте их или выберите пакетный режим`);
    }
    return {
      format: 'csv',
      summary: plan.summary,
      preview: plan.rows.slice(0, PREVIEW_ROWS).map((r) => ({ rowNo: r.rowNo, verdict: r.verdict, name: r.name, key: r.key, reason: r.reason, changes: r.changes.map(fieldLabel), lockedSkipped: r.lockedSkipped.map(fieldLabel) })),
      issues: plan.issues.slice(0, 200),
      issueCount: plan.issues.length,
      blockers,
    };
  },

  /**
   * Шаг «Применение». Проверки выполняются сразу (ошибка — исключение); сама работа идёт пакетами в фоне: возвращается runId
   * и обещание done. Страница показывает ход по import_runs.progress. Перезапись закреплённых вручную полей требует confirmOverride.
   */
  apply(session: StaffSession | null, runId: number, input: { confirmOverride?: boolean } = {}, opts: Opts = {}): ApplyHandle {
    requirePermission(session, 'import.run');
    const db = opts.db ?? getDb();
    const run = loadRun(db, runId);
    const bytes = loadStaged(opts, run);
    const s = settingsOf(run);
    if (s.import.overrideLocked && !input.confirmOverride) throw new ValidationError('Подтвердите перезапись полей, правленных вручную', { confirmOverride: ['Нужно подтверждение'] });
    const a = importOps.analyze(session, runId, opts);
    if (a.blockers.length > 0) throw new ValidationError(a.blockers[0]!, { blockers: a.blockers });
    if (a.summary.total === 0) throw new ValidationError('В файле нет строк для импорта');

    const now = nowOf(opts);
    const staffId = session.staffId;
    importRunsRepo.update(db, run.id, { mode: 'apply', status: 'running', startedAt: iso(now), progress: 0, rowsTotal: a.summary.total, finishedAt: null });
    audit.record({ actorId: staffId, actorType: 'staff', action: 'import.apply', entity: 'import', entityId: run.id, after: { fileName: run.fileName, format: run.format, mode: s.import.mode, key: s.import.key, transaction: s.import.transaction, overrideLocked: s.import.overrideLocked, rows: a.summary.total } }, { db, now });

    const finishFailed = (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      try {
        importRunsRepo.update(db, run.id, { status: 'failed', finishedAt: iso(nowOf(opts)), errors: [{ row: 0, field: '', message }] });
        audit.record({ actorId: staffId, actorType: 'staff', action: 'import.failed', entity: 'import', entityId: run.id, result: 'error', after: { error: message } }, { db, now: nowOf(opts) });
        notifyFailure(db, run.id, run.fileName, message, nowOf(opts));
      } catch {
        // журнал недоступен — запуск останется «выполняется» и будет помечен оборванным
      }
      rmSync(stagedPath(opts, run.id), { force: true });
    };

    const work = async (): Promise<void> => {
      try {
        if (run.format === 'yml') {
          const plan = planImport(parseYml(decodeBytes(bytes).text), db, { fileName: run.fileName, mode: s.import.mode, overrideLocked: s.import.overrideLocked, now: new Date(now) });
          const report = await applyImport(plan, db, {
            now: new Date(now),
            actorId: staffId,
            runId: run.id,
            mode: s.import.mode,
            overrideLocked: s.import.overrideLocked,
            atomic: s.import.transaction === 'atomic',
            images: s.import.downloadImages ? (opts.images ?? {}) : false,
            onProgress: (n) => importRunsRepo.setProgress(db, run.id, n),
          });
          importRunsRepo.update(db, run.id, { format: 'yml', rowsSkipped: report.products.unchanged });
          if (report.errors.length > 0) notifyIssues(db, run.id, run.fileName, report.errors.length, nowOf(opts));
        } else {
          const t = csvOf(bytes, s);
          const plan: CsvPlan = planRows(db, parseRows(t.headers, t.rows, s.mapping), s.import);
          const out = await applyRows(db, plan, {
            runId: run.id,
            actorId: staffId,
            now,
            options: s.import,
            images: opts.images,
            onProgress: (n) => importRunsRepo.setProgress(db, run.id, n),
          });
          const status = out.rolledBack ? 'failed' : 'done';
          importRunsRepo.update(db, run.id, {
            status,
            finishedAt: iso(nowOf(opts)),
            progress: plan.rows.length,
            productsCreated: out.created,
            productsUpdated: out.updated,
            productsUnchanged: out.skipped,
            rowsSkipped: out.skipped,
            categoriesCreated: out.categoriesCreated,
            imagesStored: out.imagesStored,
            imagesFailed: out.imagesFailed,
            errors: out.errors,
            errorCount: out.errors.length,
          });
          if (out.rolledBack) notifyFailure(db, run.id, run.fileName, out.errors[0]?.message ?? 'импорт откатан', nowOf(opts));
          else if (out.errors.length > 0) notifyIssues(db, run.id, run.fileName, out.errors.length, nowOf(opts));
        }
        rmSync(stagedPath(opts, run.id), { force: true });
      } catch (e) {
        finishFailed(e);
      }
    };
    return { runId: run.id, done: work() };
  },

  /** Журнал запусков: manager видит историю (integrations.read), admin — тоже; оборванные запуски помечаются. */
  history(session: StaffSession | null, opts: Opts & { limit?: number } = {}): ImportRunRow[] {
    requireAny(session, ['integrations.read', 'import.run', 'export.run']);
    const db = opts.db ?? getDb();
    const now = nowOf(opts);
    importRunsRepo.failStale(db, iso(now - STALE_RUN_MS), iso(now));
    return importRunsRepo.list(db, opts.limit ?? 30);
  },

  getRun(session: StaffSession | null, id: number, opts: Opts = {}): ImportRunRow | null {
    requireAny(session, ['integrations.read', 'import.run', 'export.run']);
    return importRunsRepo.get(opts.db ?? getDb(), id) ?? null;
  },

  /** Таблица ошибок запуска в CSV (строка; поле; причина). */
  errorsCsv(session: StaffSession | null, id: number, opts: Opts = {}): { fileName: string; body: string } {
    requireAny(session, ['integrations.read', 'import.run']);
    const run = importRunsRepo.get(opts.db ?? getDb(), id);
    if (!run) throw new NotFoundError('Запуск не найден');
    return { fileName: `import-${run.id}-errors.csv`, body: issuesToCsv(run.errors, run.errorCount) };
  },

  presets(session: StaffSession | null, opts: Opts = {}): ImportMappingRow[] {
    requirePermission(session, 'import.run');
    return importMappingsRepo.list(opts.db ?? getDb());
  },

  /**
   * Выгрузка товаров в CSV с учётом фильтров списка. Нужны export.run и просмотр товаров; закупочная цена — только с products.cost.
   * Число строк пишется в аудит и в историю. Это выгрузка каталога, а не резервная копия.
   */
  exportProducts(session: StaffSession | null, filter: ProductFilter, input: { presetId?: number } = {}, opts: Opts = {}): { total: number; fileName: string; chunks: Generator<string, void, void> } {
    requireAny(session, ['products.read', 'catalog.read']);
    requirePermission(session, 'export.run');
    const db = opts.db ?? getDb();
    const now = nowOf(opts);
    let mapping: Mapping | undefined;
    if (input.presetId !== undefined) {
      const preset = importMappingsRepo.get(db, input.presetId);
      if (!preset) throw new NotFoundError('Пресет не найден');
      mapping = preset.mapping;
    }
    const f = filterOf(filter);
    let res;
    try {
      res = exportProductsCsv(db, f, { withCost: hasPermission(session, 'products.cost'), mapping });
    } catch (e) {
      throw new ValidationError(e instanceof Error ? e.message : 'Не удалось сформировать выгрузку');
    }
    const runId = importRunsRepo.insert(db, {
      fileName: `products-${iso(now).slice(0, 10)}.csv`,
      mode: 'apply',
      actorId: session.staffId,
      startedAt: iso(now),
      finishedAt: iso(now),
      categoriesCreated: 0,
      categoriesUpdated: 0,
      productsCreated: 0,
      productsUpdated: 0,
      productsUnchanged: 0,
      imagesStored: 0,
      imagesFailed: 0,
      errors: [],
      kind: 'export',
      format: 'csv',
      status: 'done',
      rowsTotal: res.total,
      progress: res.total,
      options: { filter, presetId: input.presetId ?? null },
    });
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'export.run', entity: 'export', entityId: runId, after: { rows: res.total, filter, cost: hasPermission(session, 'products.cost') } }, { db, now });
    return { total: res.total, fileName: `products-${iso(now).slice(0, 10)}.csv`, chunks: res.chunks };
  },
};

function notifyFailure(db: Db, runId: number, fileName: string | null, message: string, now: number): void {
  try {
    notify(
      { type: 'import.failed', title: 'Импорт не выполнен', body: `${fileName ?? 'Файл'}: ${message}`.slice(0, 900), href: `/admin/import?run=${runId}`, entity: 'import', entityId: runId, severity: 'error', audience: 'permission:import.run' },
      { db, now },
    );
  } catch {
    // уведомление не должно ломать журнал импорта
  }
}

function notifyIssues(db: Db, runId: number, fileName: string | null, count: number, now: number): void {
  try {
    notify(
      { type: 'import.errors', title: 'Импорт завершён с ошибками', body: `${fileName ?? 'Файл'}: строк с ошибками — ${count}`, href: `/admin/import?run=${runId}`, entity: 'import', entityId: runId, severity: 'warning', audience: 'permission:import.run' },
      { db, now },
    );
  } catch {
    // см. выше
  }
}
