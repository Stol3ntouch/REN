import { createImportHandlers } from '@/app/admin/(panel)/_lib/import-handlers';

export const dynamic = 'force-dynamic';

/** GET /admin/api/import/errors?run=<id> — таблица ошибок запуска в CSV. */
export const GET = createImportHandlers().errors;
