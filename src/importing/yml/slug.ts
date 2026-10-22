const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Транслитерация + латиница в нижнем регистре, всё остальное — дефисы. Пустой результат → ''. */
export function slugify(text: string): string {
  const lat = [...text.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  return lat
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
}

/** Последний непустой сегмент пути URL (или null). */
export function lastUrlSegment(url: string | null | undefined): string | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const seg = path.split('/').filter(Boolean).at(-1);
  if (!seg) return null;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Свободный slug: base; при конфликте — base-<suffix>, затем base-<suffix>-2, -3…
 * Выбранный slug добавляется в `taken`.
 */
export function uniqueSlug(base: string, suffix: string, taken: Set<string>): string {
  const root = base || 'item';
  const withSuffix = `${root}-${slugify(suffix) || 'x'}`;
  let slug: string | undefined = [root, withSuffix].find((c) => !taken.has(c));
  for (let n = 2; !slug; n++) {
    const c = `${withSuffix}-${n}`;
    if (!taken.has(c)) slug = c;
  }
  taken.add(slug);
  return slug;
}
