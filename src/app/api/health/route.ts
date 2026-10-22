import { getDb } from '@/server/db/connection';
import { createHealthHandler } from '@/server/http/health';

export const dynamic = 'force-dynamic';

export const GET = createHealthHandler(getDb);
