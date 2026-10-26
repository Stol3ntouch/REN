const LIST = '/admin/catalog';

/** Куда вернуться после действия: только внутренний список каталога; следы прошлых результатов (ok, error, done) убираются. */
export function listBack(raw: string): string {
  if (!raw.startsWith(LIST) || raw.startsWith('//') || raw.includes('\\')) return LIST;
  const [path, qs = ''] = raw.split('?');
  if (path !== LIST) return LIST;
  const p = new URLSearchParams(qs);
  for (const k of ['ok', 'error', 'done']) p.delete(k);
  const s = p.toString();
  return s ? `${LIST}?${s}` : LIST;
}

export const withParam = (back: string, name: string, value: string): string => `${back}${back.includes('?') ? '&' : '?'}${name}=${encodeURIComponent(value)}`;
