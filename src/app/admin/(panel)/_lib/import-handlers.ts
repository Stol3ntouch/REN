import { withStaffPermission } from '@/domain/admin/guard';
import { parseProductFilter } from '@/domain/catalog/products-list';
import { MAX_IMPORT_BYTES } from '@/importing/limits';
import type { Db } from '@/server/db/connection';
import { AppError } from '@/server/http/errors';
import { importOps } from './import-ops';

type HandlerOpts = { db?: Db; now?: number; stagingDir?: string };

const see = (location: string): Response => new Response(null, { status: 303, headers: { Location: location } });
const toError = (message: string): Response => see(`/admin/import?error=${encodeURIComponent(message)}`);

/**
 * Маршруты мастера: загрузка файла (multipart, не server action: у них лимит тела 1 МБ), выгрузка товаров и таблица ошибок.
 * Origin, сессию и право проверяет withStaffPermission, затем то же делает сервисный слой.
 */
export function createImportHandlers(opts: HandlerOpts = {}) {
  const auth = opts.db ? { db: opts.db, ...(opts.now !== undefined ? { now: opts.now } : {}) } : {};
  return {
    upload: withStaffPermission(
      'import.run',
      async (req, session) => {
        const declared = Number(req.headers.get('content-length') ?? 0);
        if (declared > MAX_IMPORT_BYTES + 1024 * 1024) return toError('Файл больше 20 МБ');
        let form: FormData;
        try {
          form = await req.formData();
        } catch {
          return toError('Не удалось прочитать загрузку: отправьте файл формой');
        }
        const file = form.get('file');
        if (!(file instanceof File) || file.size === 0) return toError('Выберите файл CSV или YML для загрузки');
        if (file.size > MAX_IMPORT_BYTES) return toError('Файл больше 20 МБ');
        try {
          const res = importOps.upload(session, { fileName: file.name, content: new Uint8Array(await file.arrayBuffer()) }, opts);
          return see(`/admin/import?run=${res.runId}`);
        } catch (e) {
          if (e instanceof AppError && e.status < 500 && e.status !== 401 && e.status !== 403) return toError(e.message);
          throw e;
        }
      },
      auth,
    ),

    export: withStaffPermission(
      'export.run',
      (req, session) => {
        const sp = Object.fromEntries(new URL(req.url).searchParams);
        const preset = Number(sp.preset);
        const { chunks, fileName } = importOps.exportProducts(session, parseProductFilter(sp), Number.isInteger(preset) && preset > 0 ? { presetId: preset } : {}, opts);
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            const next = chunks.next();
            if (next.done) controller.close();
            else controller.enqueue(encoder.encode(next.value));
          },
          cancel() {
            chunks.return();
          },
        });
        return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${fileName}"`, 'cache-control': 'no-store' } });
      },
      auth,
    ),

    errors: withStaffPermission(
      'integrations.read',
      (req, session) => {
        const id = Number(new URL(req.url).searchParams.get('run'));
        const { body, fileName } = importOps.errorsCsv(session, id, opts);
        return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${fileName}"`, 'cache-control': 'no-store' } });
      },
      auth,
    ),
  };
}
