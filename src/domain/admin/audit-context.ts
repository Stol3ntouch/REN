import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';
import { getConfig } from '@/server/config';
import { clientIp } from '@/server/http/rate-limit';

/** Сведения о запросе, попадающие в журнал только хешем (IP и User-Agent в открытом виде не хранятся). */
export type RequestInfo = { ip: string | null; userAgent: string | null };

// На globalThis: обработчики Next.js живут в разных бандлах, модульная переменная была бы не общей.
const g = globalThis as unknown as { __rtsAuditCtx?: AsyncLocalStorage<RequestInfo> };
const storage = (g.__rtsAuditCtx ??= new AsyncLocalStorage<RequestInfo>());

/** Выполняет fn так, что все audit.record внутри получают IP/UA этого запроса. */
export function runWithRequestInfo<T>(info: RequestInfo, fn: () => T): T {
  return storage.run(info, fn);
}

export const currentRequestInfo = (): RequestInfo | undefined => storage.getStore();

/** IP (с учётом TRUST_PROXY) и User-Agent из заголовков запроса. */
export function requestInfoFromHeaders(headers: Headers): RequestInfo {
  let ip: string | null = null;
  try {
    const v = clientIp(headers);
    ip = v === 'unknown' ? null : v;
  } catch {
    ip = null;
  }
  const ua = headers.get('user-agent');
  return { ip, userAgent: ua ? ua.slice(0, 300) : null };
}

function secret(): string {
  try {
    return getConfig().sessionSecret ?? 'rts-audit-dev';
  } catch {
    return 'rts-audit-dev';
  }
}

/** Хеш значения для журнала: HMAC-SHA256 с секретом сайта, 16 hex-символов — достаточно, чтобы сопоставлять записи, но не восстановить IP. */
export function hashForAudit(kind: 'ip' | 'ua', value: string | null | undefined): string | null {
  if (!value) return null;
  return createHmac('sha256', secret()).update(`${kind}:${value}`).digest('hex').slice(0, 16);
}
