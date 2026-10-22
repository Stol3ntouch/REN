import { getConfig } from '../config';
import { getDb, type Db } from '../db/connection';
import { RateLimitError } from './errors';

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };
type Opts = { db?: Db; now?: number };

/**
 * Лимитер «фиксированное окно» с хранением в БД (таблица rate_limit):
 * счётчики общие для процессов и переживают перезапуск.
 * Первый запрос ключа открывает окно на windowSec секунд; в окне пропускается limit запросов.
 * Отказанные запросы окно не продлевают. now — мс (для тестов).
 */
export function rateLimit(key: string, limit: number, windowSec: number, opts: Opts = {}): RateLimitResult {
  const db = opts.db ?? getDb();
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);

  // Устаревшие окна чистим по индексу; запас в сутки не мешает окнам до суток.
  db.prepare('DELETE FROM rate_limit WHERE window_start < ?').run(nowSec - Math.max(windowSec, 86400));

  // Один атомарный upsert: либо новое окно (count=1), либо +1 в текущем.
  const row = db
    .prepare(
      `INSERT INTO rate_limit (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         window_start = CASE WHEN window_start + ?3 <= ?2 THEN ?2 ELSE window_start END,
         count        = CASE WHEN window_start + ?3 <= ?2 THEN 1 ELSE count + 1 END
       RETURNING window_start, count`,
    )
    .get(key, nowSec, windowSec) as { window_start: number; count: number };

  const allowed = row.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - row.count),
    retryAfterSec: allowed ? 0 : Math.max(1, row.window_start + windowSec - nowSec),
  };
}

/** То же, но при превышении бросает RateLimitError (→ 429 с Retry-After). */
export function enforceRateLimit(key: string, limit: number, windowSec: number, opts: Opts = {}): void {
  const res = rateLimit(key, limit, windowSec, opts);
  if (!res.allowed) throw new RateLimitError(res.retryAfterSec);
}

/**
 * IP клиента для ключей лимитера. Заголовку X-Forwarded-For верим только за своим
 * обратным прокси (TRUST_PROXY=true) и берём последний адрес — его дописал наш прокси,
 * а левые части клиент может подделать. Иначе — 'unknown' (общий бакет).
 */
export function clientIp(headers: Headers, trustProxy: boolean = getConfig().trustProxy): string {
  if (!trustProxy) return 'unknown';
  const parts = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? 'unknown';
}
