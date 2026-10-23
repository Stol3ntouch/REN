import { createAnalyticsExportHandler } from '../../_lib/analytics-handlers';

export const dynamic = 'force-dynamic';

/** GET /admin/analytics/export?kind=…&from=…&to=…&by=… — CSV, право analytics.read проверяется внутри. */
export const GET = createAnalyticsExportHandler();
