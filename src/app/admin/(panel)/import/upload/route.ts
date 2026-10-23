import { createImportHandlers } from '../../_lib/import-handlers';

export const dynamic = 'force-dynamic';

/** POST /admin/import/upload — multipart; Origin, сессия и право integrations.run проверяются внутри. */
export const POST = createImportHandlers().upload;
