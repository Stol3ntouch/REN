import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { applyImport, ImportFileError, MAX_IMPORT_BYTES, parseYml, planImport, recordPreview, type ImportReport, type PlanSummary, type RowError } from '@/importing/yml';
import { getConfig } from '@/server/config';
import { getDb, type Db } from '@/server/db/connection';
import { importRunsRepo, type ImportRunRow } from '@/server/db/repositories/import-runs';
import { NotFoundError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number; /** Каталог служебных файлов предпросмотра (по умолчанию DATA_DIR/import-staging). */ stagingDir?: string };

const ALLOWED_EXT = /\.(yml|xml)$/i;

const stagingDirOf = (o: Opts): string => o.stagingDir ?? join(getConfig().dataDir, 'import-staging');
const stagedPath = (o: Opts, previewId: number): string => join(stagingDirOf(o), `preview-${previewId}.yml`);

export type PreviewResult = { previewId: number; fileName: string; summary: PlanSummary; errors: RowError[] };

/**
 * Импорт YML для админки. Загрузка → предпросмотр (без записи в каталог) → подтверждение по id предпросмотра.
 * Имя загруженного файла в пути не участвует: служебная копия называется preview-<id>.yml.
 */
export const importOps = {
  /** Проверка файла, разбор, план, запись в журнал (mode=preview) и служебная копия для подтверждения. */
  preview(session: StaffSession | null, file: { fileName: string; content: Uint8Array }, opts: Opts = {}): PreviewResult {
    requirePermission(session, 'integrations.run');
    const fileName = file.fileName.replace(/[\\/]/g, '_').slice(0, 200);
    if (!ALLOWED_EXT.test(fileName)) throw new ValidationError('Нужен файл YML или XML (.yml, .xml)', { file: ['Неподходящий тип файла'] });
    if (file.content.byteLength === 0) throw new ValidationError('Файл пустой', { file: ['Файл пустой'] });
    if (file.content.byteLength > MAX_IMPORT_BYTES) throw new ValidationError('Файл больше 20 МБ', { file: ['Файл больше 20 МБ'] });
    const xml = Buffer.from(file.content).toString('utf8');

    let parsed;
    try {
      parsed = parseYml(xml);
    } catch (e) {
      if (e instanceof ImportFileError) throw new ValidationError(e.message, { file: [e.message] });
      throw e;
    }
    const db = opts.db ?? getDb();
    const plan = planImport(parsed, db, { fileName, now: opts.now === undefined ? undefined : new Date(opts.now) });
    const previewId = recordPreview(plan, db, { actorId: session.staffId, now: opts.now === undefined ? undefined : new Date(opts.now) });
    mkdirSync(stagingDirOf(opts), { recursive: true });
    writeFileSync(stagedPath(opts, previewId), xml, 'utf8');
    return { previewId, fileName, summary: plan.summary, errors: plan.errors };
  },

  /**
   * Подтверждение. План строится заново по текущему состоянию БД (предпросмотр мог устареть). Служебная копия
   * удаляется только после успеха: при сбое можно повторить подтверждение — повтор идемпотентен.
   */
  async apply(session: StaffSession | null, previewId: number, opts: Opts = {}): Promise<ImportReport> {
    requirePermission(session, 'integrations.run');
    const db = opts.db ?? getDb();
    const preview = Number.isInteger(previewId) ? importRunsRepo.get(db, previewId) : undefined;
    if (!preview || preview.mode !== 'preview') throw new NotFoundError('Предпросмотр не найден — загрузите файл заново');
    let xml: string;
    try {
      xml = readFileSync(stagedPath(opts, previewId), 'utf8');
    } catch {
      throw new NotFoundError('Предпросмотр устарел или уже применён — загрузите файл заново');
    }
    const now = opts.now === undefined ? undefined : new Date(opts.now);
    try {
      const plan = planImport(parseYml(xml), db, { fileName: preview.fileName, now });
      const report = await applyImport(plan, db, { actorId: session.staffId, now });
      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: 'import.apply',
          entity: 'import',
          entityId: report.runId,
          after: { fileName: report.fileName, previewId, products: report.products, categories: report.categories, errors: report.errors.length },
        },
        { db, now: opts.now },
      );
      rmSync(stagedPath(opts, previewId), { force: true });
      return report;
    } catch (e) {
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'import.failed', entity: 'import', entityId: previewId, after: { error: e instanceof Error ? e.message : String(e) } },
        { db, now: opts.now },
      );
      throw e;
    }
  },

  /** Журнал запусков (и предпросмотров): право integrations.read — видят и manager, и admin. */
  history(session: StaffSession | null, opts: Opts & { limit?: number } = {}): ImportRunRow[] {
    requirePermission(session, 'integrations.read');
    return importRunsRepo.list(opts.db ?? getDb(), opts.limit ?? 30);
  },

  getRun(session: StaffSession | null, id: number, opts: Opts = {}): ImportRunRow | null {
    requirePermission(session, 'integrations.read');
    return importRunsRepo.get(opts.db ?? getDb(), id) ?? null;
  },
};
