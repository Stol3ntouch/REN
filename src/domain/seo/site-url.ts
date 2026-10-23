type Env = Record<string, string | undefined>;

const DEV_FALLBACK = 'http://localhost:3000';

/** Публичный адрес сайта без «/» на конце. В production SITE_URL обязателен (config.ts); в dev — localhost. */
export function resolveSiteUrl(env: Env = process.env): string {
  const raw = env.SITE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // некорректный SITE_URL ловит config.ts на старте
    }
  }
  return DEV_FALLBACK;
}

export function absoluteUrl(siteUrl: string, path: string): string {
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
