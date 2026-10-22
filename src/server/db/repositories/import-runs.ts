import type { Db } from '../connection';

export type ImportRunMode = 'preview' | 'apply';

export type ImportRunInput = {
  fileName: string | null;
  mode: ImportRunMode;
  actorId?: number | null;
  startedAt: string;
  finishedAt: string;
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
};

export type ImportRunRow = Omit<ImportRunInput, 'errors' | 'actorId'> & { id: number; actorId: number | null; errorCount: number; errors: unknown[] };

export const MAX_STORED_ERRORS = 500;

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
};

function map(r: Raw): ImportRunRow {
  let errors: unknown[] = [];
  try {
    const v: unknown = JSON.parse(r.errors);
    if (Array.isArray(v)) errors = v;
  } catch {
    /* повреждённый JSON журнала не должен ронять чтение */
  }
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
    errors,
  };
}

export const importRunsRepo = {
  insert(db: Db, run: ImportRunInput): number {
    const r = db
      .prepare(
        `INSERT INTO import_runs (file_name, mode, actor_id, started_at, finished_at, categories_created, categories_updated,
           products_created, products_updated, products_unchanged, images_stored, images_failed, error_count, errors)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return Number(r.lastInsertRowid);
  },

  get(db: Db, id: number): ImportRunRow | undefined {
    const r = db.prepare('SELECT * FROM import_runs WHERE id = ?').get(id) as Raw | undefined;
    return r && map(r);
  },

  /** Последние запуски, новые первыми. */
  list(db: Db, limit = 50): ImportRunRow[] {
    return (db.prepare('SELECT * FROM import_runs ORDER BY id DESC LIMIT ?').all(limit) as Raw[]).map(map);
  },
};
