/*
 * Типы характеристик и разбор значений. Чистые функции без доступа к БД: их используют и репозиторий (запись из импорта),
 * и сервисы админки (строгая проверка введённого вручную).
 */

export const ATTRIBUTE_TYPES = ['string', 'number', 'boolean', 'list', 'date'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const ATTRIBUTE_TYPE_LABELS: Record<AttributeType, string> = {
  string: 'Строка',
  number: 'Число',
  boolean: 'Да / нет',
  list: 'Список значений',
  date: 'Дата',
};

export const MAX_VALUE_LENGTH = 500;
const NBSP = /[\s\u00a0\u202f]/g;

/** Значение, готовое к записи: text — что хранится и показывается, num — число для сравнения и диапазонов (number и boolean). */
export type CoercedValue = { text: string; num: number | null };
export type CoerceResult = { ok: true; value: CoercedValue } | { ok: false; error: string };

export function isAttributeType(v: unknown): v is AttributeType {
  return typeof v === 'string' && (ATTRIBUTE_TYPES as readonly string[]).includes(v);
}

/** «3,2», «3.2», «1 200,5», «-5» → число; всё остальное («3,2 кг», «2,5/3,4», пусто) → null. */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(NBSP, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 1e15 ? n : null;
}

const TRUE_WORDS = new Set(['да', 'true', 'yes', '1', 'y']);
const FALSE_WORDS = new Set(['нет', 'false', 'no', '0', 'n']);

export function parseBoolean(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

/** ГГГГ-ММ-ДД или ДД.ММ.ГГГГ → ISO-дата существующего дня; иначе null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])] as [number, number, number];
  else if (ru) [d, m, y] = [Number(ru[1]), Number(ru[2]), Number(ru[3])] as [number, number, number];
  else return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * СТРОГАЯ проверка значения по типу (ввод администратора, API): число — числом, логическое — да/нет (0/1),
 * дата — существующим днём, список — только из допустимых. Возвращает значение в каноническом виде.
 */
export function coerceValue(type: AttributeType, raw: string, allowed: readonly string[] = []): CoerceResult {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Значение не может быть пустым' };
  if (text.length > MAX_VALUE_LENGTH) return { ok: false, error: `Значение длиннее ${MAX_VALUE_LENGTH} символов` };
  switch (type) {
    case 'string':
      return { ok: true, value: { text, num: null } };
    case 'number': {
      const n = parseNumber(text);
      return n === null ? { ok: false, error: `«${text}» — не число` } : { ok: true, value: { text: text.replace(NBSP, ''), num: n } };
    }
    case 'boolean': {
      const b = parseBoolean(text);
      return b === null ? { ok: false, error: `«${text}» — ожидается «да» или «нет»` } : { ok: true, value: { text: b ? 'Да' : 'Нет', num: b ? 1 : 0 } };
    }
    case 'date': {
      const d = parseDate(text);
      return d === null ? { ok: false, error: `«${text}» — не дата (ГГГГ-ММ-ДД или ДД.ММ.ГГГГ)` } : { ok: true, value: { text: d, num: null } };
    }
    case 'list': {
      if (allowed.length === 0) return { ok: false, error: 'Для списка не заданы допустимые значения' };
      const key = text.toLowerCase();
      const hit = allowed.find((a) => a.toLowerCase() === key);
      return hit === undefined ? { ok: false, error: `«${text}» нет среди допустимых значений` } : { ok: true, value: { text: hit, num: null } };
    }
  }
}

/**
 * МЯГКАЯ запись (импорт YML / 1С): данные не теряем. Подходящее значение нормализуется, неподходящее сохраняется как есть
 * с num = null (в числовых диапазонах оно просто не участвует).
 */
export function coerceLenient(type: AttributeType, raw: string, allowed: readonly string[] = []): CoercedValue {
  if (type === 'string') return { text: raw, num: null };
  const strict = coerceValue(type, raw, allowed);
  if (strict.ok) return strict.value;
  return { text: raw, num: null };
}
