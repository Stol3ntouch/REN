import type { Db } from '../connection';

export type ImportRunMode = 'preview' | 'apply';
export type ImportRunKind = 'import' | 'export';
export type ImportRunStatus = 'uploaded' | 'running' | 'done' | 'failed';

export type ImportRunInput = {
  fileName: string | null;
  mode: ImportRunMode;
  actorId?: number | null;
  startedAt: string;
  finishedAt: string | null;
  categoriesCreated: number;
  categoriesUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  productsUnchanged: number;
  imagesStored: number;
  imagesFailed: number;
  /** Ошибки по строкам; хранятся первые MAX_STORED_ERRORS. */
  errors: unknown[];
  errorCount?: number;
  kind?: ImportRunKind;
  format?: string | null;
  status?: ImportRunStatus;
  progress?: number;
  rowsTotal?: number;
  rowsSkipped?: number;
  fileSize?: number;
  options?: Record<string, unknown>;
};

export type ImportRunRow = Omit<ImportRunInput, 'errors' | 'actorId' | 'finishedAt' | 'kind' | 'format' | 'status' | 'progress' | 'rowsTotal' | 'rowsSkipped' | 'fileSize' | 'options'> & {
  id: number;
  actorId: number | null;
  finishedAt: string;
  errorCount: number;
  errors: unknown[];
  kind: ImportRunKind;
  format: string | null;
  status: ImportRunStatus;
  progress: number;
  rowsTotal: number;
  rowsSkipped: number;
  fileSize: number;
  options: Record<string, unknown>;
};

export const MAX_STORED_ERRORS = 2000;

type Raw = {
  id: number;
  file_name: string | null;
  mode: ImportRunMode;
  actor_id: number | null;
  started_at: string;
  finished_at: string | null;
  categories_created: number;
  categories_updated: number;
  products_created: number;
  products_updated: number;
  products_unchanged: number;
  images_stored: number;
  images_failed: number;
  error_count: number;
  errors: string;
  kind: ImportRunKind;
  format: string | null;
  status: ImportRunStatus;
  progress: number;
  rows_total: number;
  rows_skipped: number;
  file_size: number;
  options: string;
};

function json<T>(text: string, fallback: T, ok: (v: unknown) => v is T): T {
  try {
    const v: unknown = JSON.parse(text);
    return ok(v) ? v : fallback;
  } catch {
    return fallback; // повреждённый JSON журнала не должен ронять чтение
  }
}

function map(r: Raw): ImportRunRow {
  return {
    id: r.id,
    fileName: r.file_name,
    mode: r.mode,
    actorId: r.actor_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? r.started_at,
    categoriesCreated: r.categories_created,
    categoriesUpdated: r.categories_updated,
    productsCreated: r.products_created,
    productsUpdated: r.products_updated,
    productsUnchanged: r.products_unchanged,
    imagesStored: r.images_stored,
    imagesFailed: r.images_failed,
    errorCount: r.error_count,
    errors: json<unknown[]>(r.errors, [], Array.isArray),
    kind: r.kind,
    format: r.format,
    status: r.status,
    progress: r.progress,
    rowsTotal: r.rows_total,
    rowsSkipped: r.rows_skipped,
    fileSize: r.file_size,
    options: json<Record<string, unknown>>(r.options, {}, (v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)),
  };
}

/** Что можно менять у существующей записи (ход выполнения, итоги, настройки мастера). */
export type ImportRunPatch = Partial<
  Pick<ImportRunInput, 'fileName' | 'mode' | 'finishedAt' | 'categoriesCreated' | 'categoriesUpdated' | 'productsCreated' | 'productsUpdated' | 'productsUnchanged' | 'imagesStored' | 'imagesFailed' | 'format' | 'status' | 'progress' | 'rowsTotal' | 'rowsSkipped' | 'fileSize'>
> & { errors?: unknown[]; errorCount?: number; options?: Record<string, unknown>; startedAt?: string };

const PATCH_COLUMNS: Record<string, string> = {
  fileName: 'file_name',
  mode: 'mode',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  categoriesCreated: 'categories_created',
  categoriesUpdated: 'categories_updated',
  productsCreated: 'products_created',
  productsUpdated: 'products_updated',
  productsUnchanged: 'products_unchanged',
  imagesStored: 'images_stored',
  imagesFailed: 'images_failed',
  format: 'format',
  status: 'status',
  progress: 'progress',
  rowsTotal: 'rows_total',
  rowsSkipped: 'rows_skipped',
  fileSize: 'file_size',
  errorCount: 'error_count',
};

export const importRunsRepo = {
  insert(db: Db, run: ImportRunInput): number {
    const r = db
      .prepare(
        `INSERT INTO import_runs (file_name, mode, actor_id, started_at, finished_at, categories_created, categories_updated,
           products_created, products_updated, products_unchanged, images_stored, images_failed, error_count, errors,
           kind, format, status, progress, rows_total, rows_skipped, file_size, options)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.fileName,
        run.mode,
        run.actorId ?? null,
        run.startedAt,
        run.finishedAt,
        run.categoriesCreated,
        run.categoriesUpdated,
        run.productsCreated,
        run.productsUpdated,
        run.productsUnchanged,
        run.imagesStored,
        run.imagesFailed,
        run.errorCount ?? run.errors.length,
        JSON.stringify(run.errors.slice(0, MAX_STORED_ERRORS)),
        run.kind ?? 'import',
        run.format ?? null,
        run.status ?? 'done',
        run.progress ?? 0,
        run.rowsTotal ?? 0,
        run.rowsSkipped ?? 0,
        run.fileSize ?? 0,
        JSON.stringify(run.options ?? {}),
      );
    return Number(r.lastInsertRowid);
  },

  /** Обновляет переданные поля. Ошибки обрезаются до MAX_STORED_ERRORS, errorCount по умолчанию — длина переданного списка. */
  update(db: Db, id: number, patch: ImportRunPatch): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, col] of Object.entries(PATCH_COLUMNS)) {
      const v = (patch as Record<string, unknown>)[key];
      if (v === undefined) continue;
      sets.push(`${col} = ?`);
      values.push(v as string | number | null);
    }
    if (patch.errors !== undefined) {
      sets.push('errors = ?');
      values.push(JSON.stringify(patch.errors.slice(0, MAX_STORED_ERRORS)));
      if (patch.errorCount === undefined) {
        sets.push('error_count = ?');
        values.push(patch.errors.length);
      }
    }
    if (patch.options !== undefined) {
      sets.push('options = ?');
      values.push(JSON.stringify(patch.options));
    }
    if (sets.length === 0) return;
    db.prepare(`UPDATE import_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  },

  /** Ход выполнения: только progress (дёшево, вызывается после каждого пакета). */
  setProgress(db: Db, id: number, progress: number): void {
    db.prepare('UPDATE import_runs SET progress = ? WHERE id = ?').run(progress, id);
  },

  get(db: Db, id: number): ImportRunRow | undefined {
    const r = db.prepare('SELECT * FROM import_runs WHERE id = ?').get(id) as Raw | undefined;
    return r && map(r);
  },

  /** Последние запуски, новые первыми. */
  list(db: Db, limit = 50): ImportRunRow[] {
    return (db.prepare('SELECT * FROM import_runs ORDER BY id DESC LIMIT ?').all(limit) as Raw[]).map(map);
  },

  /** Запуски, застрявшие в running (сервер перезапускали посреди импорта): помечаются failed. Возвращает их id. */
  failStale(db: Db, startedBefore: string, nowIso: string): number[] {
    const ids = (db.prepare("SELECT id FROM import_runs WHERE status = 'running' AND started_at < ?").all(startedBefore) as { id: number }[]).map((r) => r.id);
    for (const id of ids) db.prepare("UPDATE import_runs SET status = 'failed', finished_at = ? WHERE id = ?").run(nowIso, id);
    return ids;
  },
};
