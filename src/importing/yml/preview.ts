import type { Db } from '@/server/db/connection';
import { importRunsRepo } from '@/server/db/repositories/import-runs';
import type { ImportPlan } from './types';

/** Записывает предпросмотр в журнал import_runs (режим preview) и возвращает id записи. Данные каталога не меняются. */
export function recordPreview(plan: ImportPlan, db: Db, opts: { actorId?: number | null; now?: Date } = {}): number {
  const at = (opts.now ?? new Date()).toISOString();
  return importRunsRepo.insert(db, {
    fileName: plan.fileName,
    mode: 'preview',
    actorId: opts.actorId ?? null,
    startedAt: plan.generatedAt,
    finishedAt: at,
    categoriesCreated: plan.summary.categories.create,
    categoriesUpdated: plan.summary.categories.update,
    productsCreated: plan.summary.products.create,
    productsUpdated: plan.summary.products.update,
    productsUnchanged: plan.summary.products.unchanged,
    imagesStored: 0,
    imagesFailed: 0,
    errors: plan.errors,
    errorCount: plan.errors.length,
  });
}
