import { MAX_QUERY_LENGTH } from './types';

const MAX_TOKENS = 6;
const MAX_TOKEN_LENGTH = 40;
/** Окончания, которые отбрасываем у длинных русских слов («бензоножницы» ≈ «бензоножниц»). */
const RU_ENDING = /[аяыиоеуюьй]$/u;

/** Очищает пользовательский текст: обрезка до 100 символов, только буквы и цифры. */
export function tokenize(text: string): string[] {
  const cut = text.slice(0, MAX_QUERY_LENGTH).toLowerCase().replace(/ё/g, 'е');
  return (cut.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TOKENS).map((t) => t.slice(0, MAX_TOKEN_LENGTH));
}

function stem(token: string): string {
  return token.length >= 6 && /^\p{Script=Cyrillic}+$/u.test(token) ? token.replace(RU_ENDING, '') : token;
}

/** Токен как префиксный терм FTS5. Токены — только буквы/цифры, поэтому кавычка внутри невозможна. */
function term(token: string): string {
  return `"${token}"*`;
}

/**
 * Безопасное выражение MATCH для FTS5 или null, если искать нечего.
 * Пользовательский ввод никогда не попадает в синтаксис FTS: каждое слово — отдельный
 * префиксный терм в кавычках (NEAR, AND, OR, «-», «*», скобки становятся обычным текстом).
 * Варианты: все слова; соседние слова, склеенные в один («ht 625r» → «ht625r»); весь запрос слитно как артикул.
 */
export function buildMatchQuery(text: string): string | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  const variants: string[] = [];
  variants.push(`(${tokens.map((t) => term(stem(t))).join(' AND ')})`);
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const merged = [...tokens.slice(0, i), `${tokens[i]}${tokens[i + 1]}`, ...tokens.slice(i + 2)];
    variants.push(`(${merged.map((t) => term(stem(t))).join(' AND ')})`);
  }
  const compact = tokens.join('');
  if (tokens.length > 1 && compact.length <= 60) variants.push(`sku_norm : ${term(compact)}`);
  return variants.join(' OR ');
}
