const ALLOWED = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'sup', 'sub', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'td', 'th'];
const ALLOWED_SET = new Set(ALLOWED);
const STRAY_LT = new RegExp(`<(?!/?(?:${ALLOWED.join('|')})>)`, 'g');

/**
 * Очищает HTML описания из чужого фида: оставляет только безопасные теги без атрибутов,
 * вырезает script/style и подобное вместе с содержимым, комментарии и остальные теги (текст внутри сохраняется).
 * Результат безопасно выводить как HTML.
 */
export function sanitizeDescription(html: string): string | null {
  let s = html.replace(/\r/g, '');
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, '');
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, '');
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_m, slash: string, name: string) => {
    const tag = name.toLowerCase();
    return ALLOWED_SET.has(tag) ? `<${slash}${tag}>` : '';
  });
  s = s.replace(STRAY_LT, '&lt;').trim();
  return s === '' ? null : s;
}
