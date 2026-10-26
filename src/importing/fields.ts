/*
 * Поля системы, в которые можно сопоставить колонки CSV, и автоподбор по заголовкам.
 * Те же названия использует выгрузка (export.ts), поэтому выгруженный файл читается обратно без ручного сопоставления.
 */

export const FIELD_KEYS = ['sku', 'externalId', 'name', 'slug', 'price', 'oldPrice', 'stock', 'category', 'brand', 'barcode', 'description', 'published', 'images'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export type FieldDef = {
  key: FieldKey;
  /** Название в интерфейсе и заголовок колонки в выгрузке. */
  label: string;
  /** Заголовки, которые подбираются автоматически (сравнение без регистра и знаков). */
  aliases: readonly string[];
  /** Какое поле закрепляется в locked_fields за ручной правкой (null — не закрепляется). */
  lock: string | null;
  /** Пустая ячейка при «очищать пустые» стирает значение. */
  clearable: boolean;
  hint?: string;
};

export const FIELDS: readonly FieldDef[] = [
  { key: 'sku', label: 'Артикул', aliases: ['sku', 'артикул', 'код товара', 'model', 'модель', 'vendorcode'], lock: 'sku', clearable: false },
  { key: 'externalId', label: 'Внешний ID', aliases: ['external id', 'externalid', 'external_id', 'внешний id', 'внешний код', 'код 1с', 'guid', 'uuid'], lock: null, clearable: false },
  { key: 'name', label: 'Название', aliases: ['name', 'название', 'наименование', 'товар', 'title'], lock: 'name', clearable: false },
  { key: 'slug', label: 'Slug', aliases: ['slug', 'чпу', 'url', 'адрес страницы'], lock: null, clearable: false, hint: 'Только латиница, цифры и дефисы' },
  { key: 'price', label: 'Цена', aliases: ['price', 'цена', 'стоимость', 'цена, руб', 'цена руб'], lock: 'price', clearable: false },
  { key: 'oldPrice', label: 'Старая цена', aliases: ['old price', 'oldprice', 'old_price', 'старая цена', 'цена до скидки'], lock: 'old_price', clearable: true },
  { key: 'stock', label: 'Остаток', aliases: ['stock', 'остаток', 'остатки', 'количество', 'qty', 'quantity', 'кол-во'], lock: 'in_stock', clearable: false },
  { key: 'category', label: 'Категория', aliases: ['category', 'категория', 'раздел', 'группа'], lock: 'category', clearable: false, hint: 'Путь «Родитель > Дочерняя» или код' },
  { key: 'brand', label: 'Бренд', aliases: ['brand', 'бренд', 'производитель', 'vendor', 'марка'], lock: 'brand', clearable: true },
  { key: 'barcode', label: 'Штрихкод', aliases: ['barcode', 'штрихкод', 'штрих-код', 'ean', 'gtin'], lock: 'barcode', clearable: true },
  { key: 'description', label: 'Описание', aliases: ['description', 'описание', 'текст'], lock: 'description', clearable: true },
  { key: 'published', label: 'Публикация', aliases: ['published', 'публикация', 'опубликован', 'видимость', 'статус'], lock: 'published', clearable: false },
  { key: 'images', label: 'Изображения', aliases: ['images', 'image', 'изображения', 'изображение', 'фото', 'картинки', 'picture', 'pictures'], lock: 'images', clearable: true, hint: 'Ссылки через « | »' },
];

export const FIELD_BY_KEY: ReadonlyMap<string, FieldDef> = new Map(FIELDS.map((f) => [f.key, f]));

export const ATTR_PREFIX = 'attr:';
export const isAttrField = (key: string): boolean => key.startsWith(ATTR_PREFIX) && key.length > ATTR_PREFIX.length;
export const attrCode = (key: string): string => key.slice(ATTR_PREFIX.length);

/** Поле известно (системное или attr:<код>). */
export const isKnownField = (key: string): boolean => FIELD_BY_KEY.has(key) || isAttrField(key);

/** Какое имя в locked_fields соответствует полю. */
export function lockNameOf(key: string): string | null {
  if (isAttrField(key)) return 'attributes';
  return FIELD_BY_KEY.get(key)?.lock ?? null;
}

/** Колонки файла → поля системы: заголовок → ключ поля. Пустая строка значения = «не импортировать». */
export type Mapping = Record<string, string>;

/** Заголовок без регистра, пробелов по краям, ё/е и знаков препинания: «Цена, ₽» == «цена». */
export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_\-.,:;()₽]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIAS_INDEX: ReadonlyMap<string, FieldKey> = new Map(FIELDS.flatMap((f) => [f.label, ...f.aliases].map((a): [string, FieldKey] => [normalizeHeader(a), f.key])));

/**
 * Автоподбор по заголовкам. Одно поле — одна колонка (первая подходящая). `attr:<код>` и название характеристики
 * подбираются к характеристикам из справочника. Неузнанные колонки получают пустое значение (не импортируются).
 */
export function autoMap(headers: readonly string[], attributes: readonly { code: string; name: string }[] = []): Mapping {
  const out: Mapping = {};
  const used = new Set<string>();
  const byCode = new Map(attributes.map((a) => [a.code.toLowerCase(), a.code]));
  const byName = new Map(attributes.map((a) => [normalizeHeader(a.name), a.code]));
  for (const header of headers) {
    if (header in out) continue; // повтор заголовка: сопоставляется только первая колонка
    let field = '';
    const norm = normalizeHeader(header);
    const fromAlias = ALIAS_INDEX.get(norm);
    if (fromAlias && !used.has(fromAlias)) field = fromAlias;
    else if (header.trim().toLowerCase().startsWith(ATTR_PREFIX)) {
      const code = byCode.get(header.trim().slice(ATTR_PREFIX.length).toLowerCase());
      if (code && !used.has(`${ATTR_PREFIX}${code}`)) field = `${ATTR_PREFIX}${code}`;
    } else {
      const code = byName.get(norm);
      if (code && !used.has(`${ATTR_PREFIX}${code}`)) field = `${ATTR_PREFIX}${code}`;
    }
    if (field) used.add(field);
    out[header] = field;
  }
  return out;
}

/** Проверка сопоставления: неизвестное поле, одно поле в двух колонках, повтор заголовка. Пустой список — всё хорошо. */
export function validateMapping(headers: readonly string[], mapping: Mapping, knownAttrCodes?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const seenHeader = new Set<string>();
  for (const h of headers) {
    if (seenHeader.has(h) && (mapping[h] ?? '') !== '') problems.push(`Заголовок «${h}» повторяется в файле — переименуйте колонки, чтобы сопоставить каждую отдельно`);
    seenHeader.add(h);
  }
  const owner = new Map<string, string>();
  for (const h of new Set(headers)) {
    const field = mapping[h] ?? '';
    if (field === '') continue;
    if (!isKnownField(field)) {
      problems.push(`Колонка «${h}»: неизвестное поле «${field}»`);
      continue;
    }
    if (isAttrField(field) && knownAttrCodes && !knownAttrCodes.has(attrCode(field))) problems.push(`Колонка «${h}»: характеристика «${attrCode(field)}» не найдена в справочнике`);
    const prev = owner.get(field);
    if (prev !== undefined) problems.push(`Поле «${FIELD_BY_KEY.get(field)?.label ?? field}» выбрано для двух колонок: «${prev}» и «${h}»`);
    else owner.set(field, h);
  }
  return problems;
}
