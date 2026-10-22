import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type * as net from 'node:net';
import { isIP } from 'node:net';
import { isBlockedAddress } from './ip';
import { sniffImageMime, type ImageMime } from './signature';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const DEFAULT_ALLOWLIST = ['champion.ru'];

export type ImageFetchErrorCode =
  | 'invalid_url'
  | 'host_not_allowed'
  | 'blocked_address'
  | 'dns_failed'
  | 'too_many_redirects'
  | 'bad_status'
  | 'too_large'
  | 'timeout'
  | 'not_image'
  | 'network';

export class ImageFetchError extends Error {
  constructor(
    public code: ImageFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImageFetchError';
  }
}

/** Один GET без автоматических редиректов, с соединением на уже проверенный IP. */
export type HttpGet = (req: { url: URL; address: string; family: 4 | 6; signal: AbortSignal }) => Promise<{
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
}>;

/** Разрешение имени в список IP. Подменяется в тестах. */
export type Resolver = (hostname: string) => Promise<string[]>;

export type SafeFetchOptions = {
  resolver?: Resolver;
  /** Транспорт; по умолчанию node:http(s) с пином на проверенный IP (защита от DNS rebinding). */
  fetch?: HttpGet;
  /** Разрешённые хосты (поддомены включаются); по умолчанию env IMAGE_HOST_ALLOWLIST, иначе champion.ru. */
  allowlist?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

export type FetchedImage = { bytes: Buffer; mime: ImageMime };

const defaultResolver: Resolver = async (hostname) => (await lookup(hostname, { all: true })).map((a) => a.address);

/** Реальный транспорт: соединяемся с `address`, а не с именем, SNI и проверка сертификата — по имени. */
export const nodeHttpGet: HttpGet = ({ url, address, family, signal }) =>
  new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        signal,
        headers: { accept: 'image/jpeg,image/png,image/webp', 'user-agent': 'RemTehSadImporter/1.0' },
        // Имя не резолвим повторно: всегда отдаём уже проверенный адрес.
        lookup: ((_host: string, lookupOpts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (lookupOpts?.all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        }) as unknown as net.LookupFunction,
      },
      (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
        resolve({ status: res.statusCode ?? 0, headers, body: res });
      },
    );
    req.on('error', reject);
    req.end();
  });

function parseAllowlist(env: string | undefined): string[] {
  const list = (env ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_ALLOWLIST;
}

function hostAllowed(host: string, allowlist: string[]): boolean {
  return allowlist.some((a) => host === a || host.endsWith('.' + a));
}

/** Проверка URL до любого сетевого вызова: схема, учётные данные, порт, allowlist. Возвращает URL и имя хоста. */
function checkUrl(raw: string, allowlist: string[]): { url: URL; host: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageFetchError('invalid_url', 'Некорректная ссылка на изображение');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ImageFetchError('invalid_url', 'Разрешены только ссылки http и https');
  if (url.username || url.password) throw new ImageFetchError('invalid_url', 'Ссылка с логином и паролем не допускается');
  if (url.port !== '' && url.port !== '80' && url.port !== '443') throw new ImageFetchError('invalid_url', 'Нестандартный порт не допускается');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (isIP(host) || !hostAllowed(host, allowlist)) throw new ImageFetchError('host_not_allowed', `Хост «${host}» не входит в список разрешённых`);
  return { url, host };
}

async function resolveSafe(host: string, resolver: Resolver): Promise<string[]> {
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new ImageFetchError('dns_failed', `Не удалось определить адрес хоста «${host}»`);
  }
  if (addresses.length === 0) throw new ImageFetchError('dns_failed', `Не удалось определить адрес хоста «${host}»`);
  // Все адреса должны быть публичными: иначе подмена DNS подсунула бы внутренний.
  if (addresses.some(isBlockedAddress)) throw new ImageFetchError('blocked_address', `Хост «${host}» указывает на внутренний адрес`);
  return addresses;
}

async function readLimited(body: AsyncIterable<Uint8Array>, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > max) throw new ImageFetchError('too_large', 'Файл больше 5 МБ');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchChain(rawUrl: string, o: Required<Pick<SafeFetchOptions, 'resolver' | 'fetch' | 'maxBytes' | 'maxRedirects'>> & { allowlist: string[]; signal: AbortSignal }): Promise<FetchedImage> {
  let current = rawUrl;
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    const { url, host } = checkUrl(current, o.allowlist);
    const addresses = await resolveSafe(host, o.resolver);
    const address = addresses[0] as string;
    const res = await o.fetch({ url, address, family: isIP(address) === 6 ? 6 : 4, signal: o.signal });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers['location'];
      if (!location) throw new ImageFetchError('bad_status', 'Редирект без адреса назначения');
      try {
        current = new URL(location, url).href;
      } catch {
        throw new ImageFetchError('invalid_url', 'Некорректный адрес редиректа');
      }
      continue; // следующий виток заново проверяет схему, allowlist и DNS
    }
    if (res.status !== 200) throw new ImageFetchError('bad_status', `Сервер ответил кодом ${res.status}`);
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > o.maxBytes) throw new ImageFetchError('too_large', 'Файл больше 5 МБ');
    const bytes = await readLimited(res.body, o.maxBytes);
    const mime = sniffImageMime(bytes);
    if (!mime) throw new ImageFetchError('not_image', 'Файл не является изображением JPEG, PNG или WebP');
    return { bytes, mime };
  }
  throw new ImageFetchError('too_many_redirects', 'Слишком много редиректов');
}

/**
 * Безопасно скачивает изображение: allowlist хостов, запрет внутренних адресов после DNS-резолва
 * (в том числе на каждом редиректе), лимит 5 МБ, таймаут 10 с, тип — только по сигнатуре.
 * Любой отказ — ImageFetchError с кодом.
 */
export async function safeFetchImage(url: string, opts: SafeFetchOptions = {}): Promise<FetchedImage> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ImageFetchError('timeout', 'Превышено время ожидания (10 с)'));
    }, timeoutMs);
  });
  const work = fetchChain(url, {
    resolver: opts.resolver ?? defaultResolver,
    fetch: opts.fetch ?? nodeHttpGet,
    maxBytes: opts.maxBytes ?? MAX_IMAGE_BYTES,
    maxRedirects: opts.maxRedirects ?? MAX_REDIRECTS,
    allowlist: opts.allowlist?.map((h) => h.toLowerCase()) ?? parseAllowlist(process.env.IMAGE_HOST_ALLOWLIST),
    signal: controller.signal,
  }).catch((e: unknown) => {
    if (e instanceof ImageFetchError) throw e;
    if (controller.signal.aborted) throw new ImageFetchError('timeout', 'Превышено время ожидания (10 с)');
    throw new ImageFetchError('network', 'Ошибка сети при скачивании изображения');
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    work.catch(() => undefined); // проигравшая ветка не должна дать unhandled rejection
  }
}
