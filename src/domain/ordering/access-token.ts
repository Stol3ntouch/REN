import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from '@/server/config';

/**
 * Гостевая ссылка на заказ: токен = HMAC-SHA256(SESSION_SECRET, "order-access:" + номер), base64url.
 * Токен не хранится в БД и вычисляется заново, поэтому повторный place() с тем же idempotency key
 * возвращает ту же ссылку. Смена SESSION_SECRET делает старые ссылки недействительными.
 * Вне production без SESSION_SECRET используется фиксированная dev-строка (в production секрет обязателен).
 */
const DEV_SECRET = 'rts-dev-order-access-secret-not-for-production';

function secretOf(explicit?: string): string {
  if (explicit) return explicit;
  const fromConfig = getConfig().sessionSecret;
  return fromConfig ?? DEV_SECRET;
}

export function orderAccessToken(number: string, secret?: string): string {
  return createHmac('sha256', secretOf(secret)).update(`order-access:${number}`).digest('base64url');
}

export function verifyOrderAccessToken(number: string, token: string | null | undefined, secret?: string): boolean {
  if (!token || token.length > 128) return false;
  const expected = Buffer.from(orderAccessToken(number, secret));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Путь страницы заказа для гостя (с токеном). */
export function orderAccessPath(number: string, secret?: string): string {
  return `/order/${encodeURIComponent(number)}?t=${orderAccessToken(number, secret)}`;
}
