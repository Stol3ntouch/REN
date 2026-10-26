import { createImportHandlers } from '@/app/admin/(panel)/_lib/import-handlers';

export const dynamic = 'force-dynamic';

/** POST /admin/api/import/upload — multipart; Origin, сессия и право import.run проверяются внутри. */
export const POST = createImportHandlers().upload;
