import type { Db } from '../db/connection';
import { getMigrationVersion } from '../db/migrate';

/**
 * Обработчик GET /api/health. 200 + версия миграций; при недоступной БД или
 * неприменённых миграциях — 503 без деталей (ни текста исключения, ни стека).
 */
export function createHealthHandler(openDb: () => Db): () => Promise<Response> {
  return async () => {
    const headers = { 'cache-control': 'no-store' };
    try {
      const migrationVersion = getMigrationVersion(openDb());
      if (migrationVersion < 1) return Response.json({ status: 'error' }, { status: 503, headers });
      return Response.json({ status: 'ok', migrationVersion }, { status: 200, headers });
    } catch {
      return Response.json({ status: 'error' }, { status: 503, headers });
    }
  };
}
