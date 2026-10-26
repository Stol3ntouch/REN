import { withStaffPermission } from '@/domain/admin/guard';

export const dynamic = 'force-dynamic';

/** Старый адрес мастера YML: загрузка переехала в /admin/api/import/upload. Побочных действий нет — только возврат в раздел (после проверки Origin и права import.run). */
export const POST = withStaffPermission('import.run', () => new Response(null, { status: 303, headers: { Location: '/admin/import' } }));
