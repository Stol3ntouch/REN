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

/**
 * Только проверка, без учёта запроса: true — лимит по ключу уже исчерпан в текущем окне.
 * Нужна там, где считаются лишь неудачные запросы (webhook): успешные лимит не расходуют.
 */
export function isRateLimited(key: string, limit: number, windowSec: number, opts: Opts = {}): { limited: boolean; retryAfterSec: number } {
  const db = opts.db ?? getDb();
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const row = db.prepare('SELECT window_start, count FROM rate_limit WHERE key = ?').get(key) as { window_start: number; count: number } | undefined;
  if (!row || row.window_start + windowSec <= nowSec || row.count < limit) return { limited: false, retryAfterSec: 0 };
  return { limited: true, retryAfterSec: Math.max(1, row.window_start + windowSec - nowSec) };
}

/** То же, но при превышении бросает RateLimitError (→ 429 с Retry-After). */
export function enforceRateLimit(key: string, limit: number, windowSec: number, opts: Opts = {}): void {
  const res = rateLimit(key, limit, windowSec, opts);
  if (!res.allowed) throw new RateLimitError(res.retryAfterSec);
}

/** IP не определён (нет доверенного прокси): общий бакет на весь сайт заблокировал бы всех разом. */
export const UNKNOWN_IP = 'unknown';

/**
 * Лимит «префикс + IP». При неопределённом IP не применяется вовсе: ключ вида `form:x:unknown`
 * был бы одним на всех посетителей, и несколько запросов любого человека закрыли бы форму для остальных.
 */
export function rateLimitByIp(prefix: string, ip: string, limit: number, windowSec: number, opts: Opts = {}): RateLimitResult {
  if (ip === UNKNOWN_IP) return { allowed: true, remaining: limit, retryAfterSec: 0 };
  return rateLimit(`${prefix}:${ip}`, limit, windowSec, opts);
}

/** То же, но при превышении бросает RateLimitError. */
export function enforceRateLimitByIp(prefix: string, ip: string, limit: number, windowSec: number, opts: Opts = {}): void {
  const res = rateLimitByIp(prefix, ip, limit, windowSec, opts);
  if (!res.allowed) throw new RateLimitError(res.retryAfterSec);
}

/**
 * IP клиента для ключей лимитера. Заголовку X-Forwarded-For верим только за своим
 * обратным прокси (TRUST_PROXY=true) и берём последний адрес — его дописал наш прокси,
 * а левые части клиент может подделать. Иначе — 'unknown': лимиты по IP тогда пропускаются (rateLimitByIp), вход считается по логину.
 */
export function clientIp(headers: Headers, trustProxy: boolean = getConfig().trustProxy): string {
  if (!trustProxy) return UNKNOWN_IP;
  const parts = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? UNKNOWN_IP;
}
