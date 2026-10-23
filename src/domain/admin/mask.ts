/** Маскирование email и телефонов для аудита, логов и писем (R35.2). */

const EMAIL_RE = /[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;
/** Ключи, под которыми лежат секреты: значение скрывается целиком на любой глубине. */
const SECRET_KEY_RE = /pass(word)?|token|hash|secret|authorization|cookie/i;
export const HIDDEN = '[скрыто]';
const PII_KEY_RE = /e-?mail|phone|tel(?:ephone)?$|^tel|mobile/i;

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** Видны только две последние цифры. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length < 2 ? '***' : `***${digits.slice(-2)}`;
}

function maskText(text: string): string {
  return text
    .replace(EMAIL_RE, (m) => maskEmail(m))
    .replace(PHONE_RE, (m) => {
      const n = m.replace(/\D/g, '').length;
      return n >= 10 && n <= 15 ? maskPhone(m) : m;
    });
}

function maskKeyed(key: string, value: string): string {
  if (!PII_KEY_RE.test(key)) return maskText(value);
  return value.includes('@') ? maskEmail(value) : maskPhone(value);
}

/** Копия значения, где значения под секретными ключами (пароль, токен, хеш, cookie…) заменены на «[скрыто]», а email/телефон замаскированы: по имени ключа и по содержимому строк. Числа и прочее не меняются. */
export function maskPii<T>(value: T): T {
  const walk = (v: unknown, key: string): unknown => {
    if (key && SECRET_KEY_RE.test(key) && v !== null && v !== undefined && v !== '') return HIDDEN;
    if (typeof v === 'string') return key ? maskKeyed(key, v) : maskText(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x, k)]));
    }
    return v;
  };
  return walk(value, '') as T;
}
