import { createImportHandlers } from '../../_lib/import-handlers';

export const dynamic = 'force-dynamic';

/** POST /admin/import/apply — подтверждение предпросмотра; Origin, сессия и право integrations.run проверяются внутри. */
export const POST = createImportHandlers().apply;
