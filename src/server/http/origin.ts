import { getConfig } from '../config';
import { ForbiddenError } from './errors';

export type OriginCheckInput = { method: string; headers: Headers };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null; // в том числе литерал "null"
  }
}

/**
 * Защита от CSRF: небезопасные методы (POST/PUT/PATCH/DELETE) должны приходить с Origin
 * (или Referer) нашего сайта. «Наш» — это хост из заголовка Host или origin из allowedOrigins
 * (по умолчанию SITE_URL, нужно за прокси). Нет ни Origin, ни Referer → отказ.
 */
export function checkOrigin(req: OriginCheckInput, opts: { allowedOrigins?: string[] } = {}): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

  const source = req.headers.get('origin') ?? req.headers.get('referer');
  if (!source) return false;
  const origin = originOf(source);
  if (!origin) return false;

  const allowed = opts.allowedOrigins ?? [getConfig().siteUrl].filter((v): v is string => Boolean(v));
  if (allowed.some((a) => originOf(a) === origin)) return true;

  const host = req.headers.get('host');
  return host !== null && new URL(origin).host === host;
}

/** То же, но бросает ForbiddenError. */
export function assertOrigin(req: OriginCheckInput, opts: { allowedOrigins?: string[] } = {}): void {
  if (!checkOrigin(req, opts)) throw new ForbiddenError('Запрос отклонён: неверный источник');
}
