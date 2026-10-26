/*
 * Строки CSV → типизированные записи. Чистая часть, БД не нужна: проверка типов, чисел, ссылок на фото.
 * Всё, что пришло из файла, остаётся текстом: формулы (=cmd, +SUM…) не вычисляются и не исполняются.
 */
import { parseRubles } from '@/domain/pricing/format';
import { MAX_STOCK } from '@/domain/catalog/stock';
import { SLUG_PATTERN } from '@/domain/catalog/products-admin';
import { attrCode, isAttrField, type Mapping } from './fields';
import { MAX_IMAGES_PER_ROW } from './limits';

export type Issue = { row: number; field: string; message: string };

export type RowValues = {
  sku?: string;
  externalId?: string;
  name?: string;
  slug?: string;
  barcode?: string;
  description?: string;
  category?: string;
  brand?: string;
  priceKopecks?: number;
  oldPriceKopecks?: number;
  stockQty?: number;
  published?: boolean;
  images?: string[];
};

export type ParsedRow = {
  /** Номер записи в файле: заголовок — 1, первая строка данных — 2. */
  rowNo: number;
  values: RowValues;
  /** Значения характеристик: код → текст (только непустые). */
  attrs: Record<string, string>;
  /** Поля, колонка которых сопоставлена, а ячейка пуста. */
  empty: string[];
  issues: Issue[];
};

const MAX_NAME = 300;
const MAX_SKU = 100;
const MAX_TEXT = 100_000;
const MAX_URL = 2000;
const MAX_KOPECKS = 10_000_000_000;

const TRUE_WORDS = new Set(['да', 'yes', 'true', '1', 'y', 'опубликован', 'опубликовано', 'показывать', 'вкл', 'on', 'активен']);
const FALSE_WORDS = new Set(['нет', 'no', 'false', '0', 'n', 'скрыт', 'не опубликован', 'снят', 'снят с публикации', 'не показывать', 'выкл', 'off', 'неактивен']);

/** Экранирование формул при выгрузке («'=…») снимается при чтении, чтобы выгруженный файл читался без искажений. */
export function cleanCell(raw: string): string {
  let t = raw.replace(/\u0000/g, '').trim();
  if (/^'[=+\-@\t\r]/.test(t)) t = t.slice(1);
  return t;
}

export function parseMoney(raw: string): number | null {
  const t = raw.replace(/\s*(₽|руб\.?|р\.?)$/i, '').trim();
  const k = parseRubles(t);
  return k !== null && k <= MAX_KOPECKS ? k : null;
}

export function parseBool(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

function isHttpUrl(u: string): boolean {
  if (u.length > MAX_URL) return false;
  try {
    const p = new URL(u);
    return (p.protocol === 'http:' || p.protocol === 'https:') && !!p.hostname;
  } catch {
    return false;
  }
}

/** Ссылки на фото: разделители «|», перенос строки или пробел. */
export function splitUrls(raw: string): string[] {
  return raw
    .split(/[|\r\n\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Разбор строк данных (без заголовка) по сопоставлению. Ошибка типа попадает в issues строки (строка потом получит вердикт
 * «ошибка»), остальные строки не страдают.
 */
export function parseRows(headers: readonly string[], dataRows: readonly (readonly string[])[], mapping: Mapping): ParsedRow[] {
  const cols: { idx: number; field: string }[] = [];
  const claimed = new Set<string>();
  const seenHeader = new Set<string>();
  headers.forEach((h, idx) => {
    if (seenHeader.has(h)) return; // повтор заголовка: учитывается только первая колонка
    seenHeader.add(h);
    const field = mapping[h] ?? '';
    if (field !== '' && !claimed.has(field)) {
      claimed.add(field);
      cols.push({ idx, field });
    }
  });

  return dataRows.map((cells, i): ParsedRow => {
    const rowNo = i + 2;
    const row: ParsedRow = { rowNo, values: {}, attrs: {}, empty: [], issues: [] };
    const bad = (field: string, message: string) => row.issues.push({ row: rowNo, field, message });
    if (cells.length > headers.length && cells.slice(headers.length).some((c) => c.trim() !== '')) bad('', `В строке ${cells.length} ячеек, а в заголовке ${headers.length}: лишние данные не импортируются`);

    for (const { idx, field } of cols) {
      const text = cleanCell(cells[idx] ?? '');
      if (text === '') {
        row.empty.push(field);
        continue;
      }
      if (isAttrField(field)) {
        if (text.length > 500) bad(field, `Значение характеристики длиннее 500 символов`);
        else row.attrs[attrCode(field)] = text;
        continue;
      }
      switch (field) {
        case 'sku':
          if (text.length > MAX_SKU) bad(field, `Артикул длиннее ${MAX_SKU} символов`);
          else row.values.sku = text;
          break;
        case 'externalId':
          if (text.length > MAX_SKU) bad(field, `Внешний ID длиннее ${MAX_SKU} символов`);
          else row.values.externalId = text;
          break;
        case 'name':
          if (text.length > MAX_NAME) bad(field, `Название длиннее ${MAX_NAME} символов`);
          else row.values.name = text;
          break;
        case 'slug': {
          const s = text.toLowerCase();
          if (!SLUG_PATTERN.test(s) || s.length > 120) bad(field, `Slug «${text.slice(0, 40)}»: только латиница, цифры и дефисы`);
          else row.values.slug = s;
          break;
        }
        case 'barcode':
          if (!/^[0-9A-Za-z-]{4,32}$/.test(text)) bad(field, `Штрихкод «${text.slice(0, 40)}»: 4–32 символа, цифры и латиница`);
          else row.values.barcode = text;
          break;
        case 'description':
          if (text.length > MAX_TEXT) bad(field, 'Описание слишком длинное');
          else row.values.description = text;
          break;
        case 'category':
          row.values.category = text.slice(0, 500);
          break;
        case 'brand':
          if (text.length > 200) bad(field, 'Название бренда длиннее 200 символов');
          else row.values.brand = text;
          break;
        case 'price':
        case 'oldPrice': {
          const k = parseMoney(text);
          if (k === null) bad(field, `«${text.slice(0, 40)}» — не цена (пример: 1250,50)`);
          else if (field === 'price') row.values.priceKopecks = k;
          else row.values.oldPriceKopecks = k;
          break;
        }
        case 'stock': {
          const m = /^(\d+)(?:[.,]0+)?$/.exec(text.replace(/[\s ]/g, ''));
          const n = m ? Number(m[1]) : NaN;
          if (!Number.isInteger(n) || n < 0 || n > MAX_STOCK) bad(field, `«${text.slice(0, 40)}» — остаток должен быть целым числом от 0`);
          else row.values.stockQty = n;
          break;
        }
        case 'published': {
          const b = parseBool(text);
          if (b === null) bad(field, `«${text.slice(0, 40)}» — ожидалось «да» или «нет»`);
          else row.values.published = b;
          break;
        }
        case 'images': {
          const urls = splitUrls(text);
          const wrong = urls.find((u) => !isHttpUrl(u));
          if (wrong) bad(field, `Ссылка на фото «${wrong.slice(0, 60)}» не http/https`);
          else if (urls.length > MAX_IMAGES_PER_ROW) bad(field, `Фото больше ${MAX_IMAGES_PER_ROW}`);
          else row.values.images = [...new Set(urls)];
          break;
        }
      }
    }
    return row;
  });
}
