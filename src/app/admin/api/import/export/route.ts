import { createImportHandlers } from '@/app/admin/(panel)/_lib/import-handlers';

export const dynamic = 'force-dynamic';

/** GET /admin/api/import/export?<фильтры списка товаров>&preset=<id> — CSV товаров (не резервная копия). Нужны export.run и просмотр товаров. */
export const GET = createImportHandlers().export;
