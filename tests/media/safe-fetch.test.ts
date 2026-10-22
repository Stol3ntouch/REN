import { describe, expect, it } from 'vitest';
import { ImageFetchError, safeFetchImage, type HttpGet } from '@/media/safe-fetch';

// Минимальные настоящие сигнатуры JPEG / PNG / WebP.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(40, 3)]);

type Reply = { status?: number; headers?: Record<string, string>; body?: Buffer | Buffer[] };

/** Поддельный транспорт: отдаёт ответы по очереди и запоминает, к каким адресам ходили. */
function fakeHttp(replies: Reply[]) {
  const calls: { url: string; address: string }[] = [];
  const fn: HttpGet = async ({ url, address }) => {
    calls.push({ url: url.href, address });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)] as Reply;
    const chunks = Array.isArray(r.body) ? r.body : [r.body ?? JPEG];
    return {
      status: r.status ?? 200,
      headers: r.headers ?? {},
      body: (async function* () {
        for (const c of chunks) yield new Uint8Array(c);
      })(),
    };
  };
  return { fn, calls };
}

const publicResolver = async () => ['93.184.216.34'];
const opts = (fetch: HttpGet, extra: Record<string, unknown> = {}) => ({ resolver: publicResolver, fetch, allowlist: ['champion.ru'], ...extra });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ImageFetchError) return e.code;
    throw e;
  }
  return 'ok';
}

describe('safeFetchImage: допустимые', () => {
  it('скачивает JPEG с разрешённого хоста и определяет тип по сигнатуре, а не по заголовку', async () => {
    const { fn, calls } = fakeHttp([{ headers: { 'content-type': 'text/plain' }, body: JPEG }]);
    const r = await safeFetchImage('https://champion.ru/upload/a.jpg', opts(fn));
    expect(r.mime).toBe('image/jpeg');
    expect(r.bytes.equals(JPEG)).toBe(true);
    expect(calls[0]?.address).toBe('93.184.216.34'); // соединение идёт на проверенный IP
  });

  it('принимает PNG, WebP и поддомен разрешённого хоста', async () => {
    expect((await safeFetchImage('https://static.champion.ru/a', opts(fakeHttp([{ body: PNG }]).fn))).mime).toBe('image/png');
    expect((await safeFetchImage('https://champion.ru/a', opts(fakeHttp([{ body: WEBP }]).fn))).mime).toBe('image/webp');
  });

  it('следует редиректу на другой разрешённый хост', async () => {
    const { fn, calls } = fakeHttp([{ status: 302, headers: { location: 'https://cdn.champion.ru/x.jpg' } }, { body: JPEG }]);
    const r = await safeFetchImage('https://champion.ru/a', opts(fn));
    expect(r.mime).toBe('image/jpeg');
    expect(calls.map((c) => c.url)).toEqual(['https://champion.ru/a', 'https://cdn.champion.ru/x.jpg']);
  });
});

describe('safeFetchImage: отказы', () => {
  it.each([
    ['https://evil.example.com/a.jpg', 'host_not_allowed'],
    ['https://champion.ru.evil.com/a.jpg', 'host_not_allowed'],
    ['https://notchampion.ru/a.jpg', 'host_not_allowed'],
    ['http://localhost/a.jpg', 'host_not_allowed'],
    ['http://127.0.0.1/a.jpg', 'host_not_allowed'],
    ['http://10.0.0.5/a.jpg', 'host_not_allowed'],
    ['http://169.254.169.254/latest/meta-data', 'host_not_allowed'],
    ['http://[::1]/a.jpg', 'host_not_allowed'],
    ['ftp://champion.ru/a.jpg', 'invalid_url'],
    ['file:///etc/passwd', 'invalid_url'],
    ['javascript:alert(1)', 'invalid_url'],
    ['not a url', 'invalid_url'],
    ['https://user:pass@champion.ru/a.jpg', 'invalid_url'],
    ['https://champion.ru:8080/a.jpg', 'invalid_url'],
  ])('%s → %s (сеть не трогаем)', async (url, code) => {
    const { fn, calls } = fakeHttp([{ body: JPEG }]);
    expect(await codeOf(safeFetchImage(url, opts(fn)))).toBe(code);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['127.0.0.1'],
    ['10.1.2.3'],
    ['172.16.0.9'],
    ['192.168.1.1'],
    ['169.254.169.254'],
    ['100.64.0.1'],
    ['0.0.0.0'],
    ['::1'],
    ['::'],
    ['fe80::1'],
    ['fc00::5'],
    ['::ffff:127.0.0.1'],
    ['::ffff:10.0.0.1'],
  ])('разрешённый хост, который резолвится в %s, отклоняется после DNS', async (ip) => {
    const { fn, calls } = fakeHttp([{ body: JPEG }]);
    expect(await codeOf(safeFetchImage('https://champion.ru/a.jpg', opts(fn, { resolver: async () => [ip] })))).toBe('blocked_address');
    expect(calls).toHaveLength(0);
  });

  it('отклоняет, если хотя бы один из адресов ответа DNS частный (rebinding)', async () => {
    const { fn } = fakeHttp([{ body: JPEG }]);
    const code = await codeOf(safeFetchImage('https://champion.ru/a', opts(fn, { resolver: async () => ['93.184.216.34', '127.0.0.1'] })));
    expect(code).toBe('blocked_address');
  });

  it('allowlist с localhost не обходит запрет на внутренние адреса', async () => {
    const { fn } = fakeHttp([{ body: JPEG }]);
    const code = await codeOf(safeFetchImage('http://localhost/a.jpg', opts(fn, { allowlist: ['localhost'], resolver: async () => ['127.0.0.1'] })));
    expect(code).toBe('blocked_address');
  });

  it('ошибка DNS → dns_failed', async () => {
    const { fn } = fakeHttp([{ body: JPEG }]);
    const resolver = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fn, { resolver })))).toBe('dns_failed');
  });

  it('редирект на внутренний адрес или чужой хост отклоняется', async () => {
    for (const location of ['http://127.0.0.1/admin', 'http://169.254.169.254/x', 'http://[::1]/x', 'https://evil.example.com/a.jpg']) {
      const { fn, calls } = fakeHttp([{ status: 301, headers: { location } }, { body: JPEG }]);
      expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fn)))).toBe('host_not_allowed');
      expect(calls).toHaveLength(1);
    }
  });

  it('редирект на разрешённое имя, которое резолвится во внутренний адрес, отклоняется', async () => {
    const { fn } = fakeHttp([{ status: 302, headers: { location: 'https://internal.champion.ru/x' } }, { body: JPEG }]);
    const resolver = async (h: string) => (h.startsWith('internal') ? ['10.0.0.7'] : ['93.184.216.34']);
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fn, { resolver })))).toBe('blocked_address');
  });

  it('бесконечные редиректы обрываются', async () => {
    const { fn } = fakeHttp([{ status: 302, headers: { location: 'https://champion.ru/b' } }]);
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fn)))).toBe('too_many_redirects');
  });

  it('редирект без Location и неуспешный статус отклоняются', async () => {
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fakeHttp([{ status: 302 }]).fn)))).toBe('bad_status');
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fakeHttp([{ status: 404 }]).fn)))).toBe('bad_status');
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fakeHttp([{ status: 500 }]).fn)))).toBe('bad_status');
  });

  it('ответ больше 5 МБ отклоняется: по Content-Length и по фактическому потоку', async () => {
    const size = String(5 * 1024 * 1024 + 1);
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fakeHttp([{ headers: { 'content-length': size }, body: JPEG }]).fn)))).toBe('too_large');
    // заголовок врёт — читаем кусками и обрываем по факту
    const chunks = [JPEG, Buffer.alloc(3 * 1024 * 1024), Buffer.alloc(3 * 1024 * 1024)];
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fakeHttp([{ body: chunks }]).fn)))).toBe('too_large');
  });

  it('не-изображение отклоняется, даже если Content-Type врёт', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(await codeOf(safeFetchImage('https://champion.ru/a.jpg', opts(fakeHttp([{ headers: { 'content-type': 'image/jpeg' }, body: html }]).fn)))).toBe('not_image');
    expect(await codeOf(safeFetchImage('https://champion.ru/a.svg', opts(fakeHttp([{ body: Buffer.from('<svg onload="x()"/>') }]).fn)))).toBe('not_image');
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(fakeHttp([{ body: Buffer.alloc(0) }]).fn)))).toBe('not_image');
  });

  it('таймаут обрывает зависший запрос', async () => {
    const hang: HttpGet = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await codeOf(safeFetchImage('https://champion.ru/a', opts(hang, { timeoutMs: 30 })))).toBe('timeout');
  });
});

describe('safeFetchImage: allowlist из окружения', () => {
  it('по умолчанию разрешён champion.ru, остальное нет; IMAGE_HOST_ALLOWLIST переопределяет', async () => {
    const saved = process.env.IMAGE_HOST_ALLOWLIST;
    delete process.env.IMAGE_HOST_ALLOWLIST;
    try {
      const o = { resolver: publicResolver, fetch: fakeHttp([{ body: JPEG }]).fn };
      expect((await safeFetchImage('https://champion.ru/a', o)).mime).toBe('image/jpeg');
      expect(await codeOf(safeFetchImage('https://example.org/a', o))).toBe('host_not_allowed');
      process.env.IMAGE_HOST_ALLOWLIST = 'example.org, cdn.test.ru';
      expect((await safeFetchImage('https://example.org/a', o)).mime).toBe('image/jpeg');
      expect(await codeOf(safeFetchImage('https://champion.ru/a', o))).toBe('host_not_allowed');
    } finally {
      if (saved === undefined) delete process.env.IMAGE_HOST_ALLOWLIST;
      else process.env.IMAGE_HOST_ALLOWLIST = saved;
    }
  });
});

describe('nodeHttpGet: реальный транспорт', () => {
  it('соединяется с переданным адресом, а не резолвит имя заново, и отдаёт тело потоком', async () => {
    const http = await import('node:http');
    const { nodeHttpGet } = await import('@/media/safe-fetch');
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'image/jpeg');
      res.end((req.headers.host ?? '').startsWith('champion.ru:') ? JPEG : 'wrong host');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      // Имя champion.ru не существует в DNS локально: ответ придёт только если соединение пошло на pinned-адрес.
      const res = await nodeHttpGet({ url: new URL(`http://champion.ru:${port}/a.jpg`), address: '127.0.0.1', family: 4, signal: new AbortController().signal });
      const chunks: Buffer[] = [];
      for await (const c of res.body) chunks.push(Buffer.from(c));
      expect(res.status).toBe(200);
      expect(Buffer.concat(chunks).equals(JPEG)).toBe(true);
    } finally {
      server.close();
    }
  });
});
