import { withStaffPermission } from '@/domain/admin/guard';
import { MAX_IMPORT_BYTES } from '@/importing/yml';
import type { Db } from '@/server/db/connection';
import { AppError } from '@/server/http/errors';
import { importOps } from './import-ops';

type HandlerOpts = { db?: Db; now?: number; stagingDir?: string };

const see = (location: string): Response => new Response(null, { status: 303, headers: { Location: location } });
const toError = (message: string): Response => see(`/admin/import?error=${encodeURIComponent(message)}`);

/**
 * POST /admin/import/upload (multipart) и /admin/import/apply. Origin, сессия и право integrations.run проверяет
 * withStaffPermission, затем ту же проверку делает сервисный слой. Ответ — редирект: страница /admin/import показывает результат.
 */
export function createImportHandlers(opts: HandlerOpts = {}) {
  const auth = opts.db ? { db: opts.db, ...(opts.now !== undefined ? { now: opts.now } : {}) } : {};
  return {
    upload: withStaffPermission(
      'integrations.run',
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
        if (!(file instanceof File) || file.size === 0) return toError('Выберите файл YML для загрузки');
        if (file.size > MAX_IMPORT_BYTES) return toError('Файл больше 20 МБ');
        try {
          const res = importOps.preview(session, { fileName: file.name, content: new Uint8Array(await file.arrayBuffer()) }, opts);
          return see(`/admin/import?preview=${res.previewId}`);
        } catch (e) {
          if (e instanceof AppError && e.status < 500 && e.status !== 401 && e.status !== 403) return toError(e.message);
          throw e;
        }
      },
      auth,
    ),

    apply: withStaffPermission(
      'integrations.run',
      async (req, session) => {
        const form = await req.formData().catch(() => null);
        const id = Number(form?.get('previewId'));
        if (!Number.isInteger(id) || id < 1) return toError('Предпросмотр не найден — загрузите файл заново');
        try {
          const report = await importOps.apply(session, id, opts);
          return see(`/admin/import?report=${report.runId}`);
        } catch (e) {
          if (e instanceof AppError && e.status < 500 && e.status !== 401 && e.status !== 403) return toError(e.message);
          return toError('Импорт не выполнен из-за ошибки. Повторите подтверждение — повтор безопасен; подробности в журнале аудита.');
        }
      },
      auth,
    ),
  };
}
