/*
 * План применения CSV: для каждой строки вердикт «создать / обновить / пропустить / ошибка» и список изменений.
 * В БД ничего не пишет. Решения принимаются здесь и по текущему состоянию БД: предпросмотр, проверка и применение
 * строятся одним и тем же кодом, поэтому расходиться не могут.
 */
import { coerceValue } from '@/domain/catalog/attribute-types';
import { sanitizeDescription } from '@/importing/yml/sanitize';
import type { Db } from '@/server/db/connection';
import { foldText } from '@/server/db/fold';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { imagesRepo } from '@/server/db/repositories/images';
import { productsAdminRepo, type ProductFull } from '@/server/db/repositories/products-admin';
import { FIELD_BY_KEY, lockNameOf } from '../fields';
import type { ImportOptions } from '../options';
import type { Issue, ParsedRow } from '../rows';
import { loadProductKeys, loadRefs, resolveCategory, type CatalogRefs, type ProductKeys } from './refs';

export type Verdict = 'create' | 'update' | 'skip' | 'error';

export type AttrValue = { text: string; num: number | null };

/** Что строка хочет записать. null — стереть значение (только при «очищать пустые»). */
export type Intent = {
  sku?: string;
  externalId?: string;
  name?: string;
  slug?: string;
  barcode?: string | null;
  description?: string | null;
  category?: string;
  brand?: string | null;
  priceKopecks?: number;
  oldPriceKopecks?: number | null;
  stockQty?: number;
  published?: boolean;
  images?: string[];
  attrs?: Record<string, AttrValue | null>;
};

export type PlannedRow = {
  rowNo: number;
  verdict: Verdict;
  /** Для показа: название товара (из файла или из каталога). */
  name: string | null;
  /** Значение ключа строки (артикул / внешний ID / штрихкод). */
  key: string | null;
  productId: number | null;
  /** Поля, которые будут записаны (для update). */
  changes: string[];
  /** Поля, где файл отличается, но они закреплены за ручной правкой. */
  lockedSkipped: string[];
  /** Причина пропуска или первая ошибка — для таблицы предпросмотра. */
  reason: string | null;
  issues: Issue[];
  intent: Intent;
};

export type CsvPlan = {
  rows: PlannedRow[];
  summary: { total: number; create: number; update: number; skip: number; error: number; lockedSkipped: number; categoriesToCreate: number; brandsToCreate: number };
  /** Все ошибки по строкам (для таблицы и выгрузки). */
  issues: Issue[];
};

type KeyName = 'sku' | 'external_id' | 'barcode';
const KEY_LABEL: Record<KeyName, string> = { sku: 'артикул', external_id: 'внешний ID', barcode: 'штрихкод' };
const KEY_FIELD: Record<KeyName, string> = { sku: 'sku', external_id: 'externalId', barcode: 'barcode' };

function lookupKeys(o: ImportOptions): KeyName[] {
  if (o.mode === 'update') return [o.key];
  return [...new Set<KeyName>(['sku', 'external_id', ...(o.key === 'barcode' ? (['barcode'] as const) : [])])];
}

function keyValue(r: ParsedRow, k: KeyName): string | undefined {
  return k === 'sku' ? r.values.sku : k === 'external_id' ? r.values.externalId : r.values.barcode;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Намерения строки: что записать, с проверкой характеристик. */
function buildIntent(row: ParsedRow, options: ImportOptions, refs: CatalogRefs, bad: (field: string, message: string) => void): Intent {
  const v = row.values;
  const intent: Intent = {};
  if (v.sku !== undefined) intent.sku = v.sku;
  if (v.externalId !== undefined) intent.externalId = v.externalId;
  if (v.name !== undefined) intent.name = v.name;
  if (v.slug !== undefined) intent.slug = v.slug;
  if (v.barcode !== undefined) intent.barcode = v.barcode;
  if (v.description !== undefined) intent.description = sanitizeDescription(v.description);
  if (v.category !== undefined) intent.category = v.category;
  if (v.brand !== undefined) intent.brand = v.brand;
  if (v.priceKopecks !== undefined) intent.priceKopecks = v.priceKopecks;
  if (v.oldPriceKopecks !== undefined) intent.oldPriceKopecks = v.oldPriceKopecks;
  if (v.stockQty !== undefined) intent.stockQty = v.stockQty;
  if (v.published !== undefined) intent.published = v.published;
  if (v.images !== undefined) intent.images = v.images;
  if (options.clearEmpty) {
    for (const f of row.empty) {
      if (f === 'oldPrice') intent.oldPriceKopecks = null;
      else if (f === 'brand') intent.brand = null;
      else if (f === 'barcode') intent.barcode = null;
      else if (f === 'description') intent.description = null;
      else if (f === 'images') intent.images = [];
      else if (f.startsWith('attr:')) {
        const def = refs.attrs.get(f.slice(5).toLowerCase());
        if (def?.required) bad(f, `«${def.name}»: обязательная характеристика, очистить нельзя`);
        else (intent.attrs ??= {})[def?.code ?? f.slice(5)] = null;
      }
    }
  }
  for (const [code, raw] of Object.entries(row.attrs)) {
    const def = refs.attrs.get(code.toLowerCase());
    if (!def) {
      bad(`attr:${code}`, `Характеристика «${code}» не найдена в справочнике`);
      continue;
    }
    const r = coerceValue(def.type, raw, def.allowedValues);
    if (!r.ok) bad(`attr:${code}`, `«${def.name}»: ${r.error}`);
    else (intent.attrs ??= {})[def.code] = r.value;
  }
  return intent;
}

/** Сравнение намерений строки с сохранённым товаром: что изменится и что закреплено вручную. */
function diffExisting(db: Db, p: ProductFull, intent: Intent, refs: CatalogRefs, options: ImportOptions): { changes: string[]; lockedSkipped: string[] } {
  const differing: string[] = [];
  const catId = intent.category !== undefined ? resolveCategory(refs, intent.category) : null;
  if (intent.name !== undefined && intent.name !== p.name) differing.push('name');
  if (intent.sku !== undefined && intent.sku !== p.sku) differing.push('sku');
  if (intent.slug !== undefined && intent.slug !== p.slug) differing.push('slug');
  if (intent.barcode !== undefined && intent.barcode !== p.barcode) differing.push('barcode');
  if (intent.description !== undefined && (intent.description ?? null) !== (p.description ?? null)) differing.push('description');
  if (catId && (catId.kind !== 'found' || catId.id !== p.categoryId)) differing.push('category');
  if (intent.brand !== undefined) {
    const target = intent.brand === null ? null : (refs.brands.get(foldText(intent.brand.trim()))?.id ?? -1);
    if (target !== p.brandId) differing.push('brand');
  }
  if (intent.priceKopecks !== undefined && intent.priceKopecks !== p.priceKopecks) differing.push('price');
  if (intent.oldPriceKopecks !== undefined && (intent.oldPriceKopecks ?? null) !== p.oldPriceKopecks) differing.push('oldPrice');
  if (intent.stockQty !== undefined && (intent.stockQty !== p.stockQty || !p.stockTracked)) differing.push('stock');
  if (intent.published !== undefined && intent.published !== p.published) differing.push('published');
  if (intent.images !== undefined) {
    const stored = imagesRepo.listByProduct(db, p.id).map((i) => i.urlSource);
    if (!sameJson(stored, intent.images)) differing.push('images');
  }
  if (intent.attrs) {
    const stored = new Map(attributesRepo.valuesOfProduct(db, p.id).map((a) => [a.attributeId, a.value]));
    for (const [code, val] of Object.entries(intent.attrs)) {
      const def = refs.attrs.get(code.toLowerCase());
      if (!def) continue;
      const cur = stored.get(def.id) ?? null;
      if ((val?.text ?? null) !== cur) differing.push(`attr:${def.code}`);
    }
  }
  const locked = new Set(p.lockedFields);
  const changes: string[] = [];
  const lockedSkipped: string[] = [];
  for (const f of differing) {
    const lock = lockNameOf(f);
    if (lock && locked.has(lock) && !options.overrideLocked) lockedSkipped.push(f);
    else changes.push(f);
  }
  return { changes, lockedSkipped };
}

/**
 * План по разобранным строкам. Проверяет: обязательные поля нового товара, дубли ключей внутри файла и в базе,
 * неизвестные категории/бренды (создавать или ошибка), занятые slug, старую цену, закреплённые поля.
 */
export function planRows(db: Db, rows: readonly ParsedRow[], options: ImportOptions, shared?: { refs?: CatalogRefs; keys?: ProductKeys }): CsvPlan {
  const refs = shared?.refs ?? loadRefs(db);
  const keys = shared?.keys ?? loadProductKeys(db);
  const lookup = lookupKeys(options);
  const seen = new Map<string, number>();
  const seenSlug = new Map<string, number>();
  const newCategories = new Set<string>();
  const newBrands = new Set<string>();
  const planned: PlannedRow[] = [];
  const allIssues: Issue[] = [];

  const idsFor = (k: KeyName, value: string): number[] => (k === 'sku' ? keys.bySku : k === 'external_id' ? keys.byExt : keys.byBarcode).get(value) ?? [];

  for (const row of rows) {
    const issues: Issue[] = [...row.issues];
    const bad = (field: string, message: string) => issues.push({ row: row.rowNo, field, message });
    const intent = buildIntent(row, options, refs, bad);
    const v = row.values;

    // --- ключ и дубли внутри файла
    const present = lookup.filter((k) => keyValue(row, k) !== undefined);
    const keyText = (() => {
      const first = present[0];
      return first ? (keyValue(row, first) ?? null) : null;
    })();
    if (present.length === 0) {
      bad(KEY_FIELD[lookup[0]!], `Не заполнено: ${lookup.map((k) => KEY_LABEL[k]).join(' / ')} — по нему строка сопоставляется с товаром`);
    }
    const dupKeys: KeyName[] = [...new Set<KeyName>([...lookup, 'sku', 'external_id'])];
    for (const k of dupKeys) {
      const val = keyValue(row, k);
      if (val === undefined) continue;
      const token = `${k}:${val}`;
      const at = seen.get(token);
      if (at !== undefined) bad(KEY_FIELD[k], `Дубль в файле: ${KEY_LABEL[k]} «${val}» уже есть в строке ${at}`);
      else seen.set(token, row.rowNo);
    }

    // --- существующий товар
    const matched = new Set<number>();
    for (const k of present) for (const id of idsFor(k, keyValue(row, k)!)) matched.add(id);
    let existing: ProductFull | undefined;
    if (matched.size > 1) bad(KEY_FIELD[present[0] ?? lookup[0]!], `Ключу соответствует несколько товаров (id ${[...matched].slice(0, 5).join(', ')}) — исправьте дубли в каталоге`);
    else if (matched.size === 1) existing = productsAdminRepo.findById(db, [...matched][0]!);
    const existingId = existing?.id ?? null;

    // --- занятые артикул, внешний ID, slug
    if (v.sku !== undefined) {
      const other = idsFor('sku', v.sku).filter((id) => id !== existingId);
      if (other.length > 0 && matched.size <= 1) bad('sku', `Артикул «${v.sku}» уже занят товаром id ${other[0]}`);
    }
    if (v.externalId !== undefined && !existing) {
      const other = idsFor('external_id', v.externalId);
      if (other.length > 0) bad('externalId', `Внешний ID «${v.externalId}» уже занят товаром id ${other[0]}`);
    }
    if (v.slug !== undefined) {
      const owner = productsAdminRepo.slugOwner(db, v.slug, existingId ?? undefined);
      const at = seenSlug.get(v.slug);
      if (owner !== null) bad('slug', `Slug «${v.slug}» уже занят товаром id ${owner}`);
      else if (at !== undefined) bad('slug', `Slug «${v.slug}» уже указан в строке ${at}`);
      else seenSlug.set(v.slug, row.rowNo);
    }

    // --- создаётся ли товар
    let verdict: Verdict;
    let reason: string | null = null;
    if (existing) {
      if (options.mode === 'create_only') {
        verdict = 'skip';
        reason = 'Уже есть в каталоге';
      } else verdict = 'update'; // уточняется ниже по различиям
    } else if (options.mode === 'update' && !options.createMissing) {
      verdict = 'skip';
      reason = 'Нет в каталоге, создание отключено';
    } else {
      verdict = 'create';
      const has = (f: string) => issues.some((i) => i.field === f);
      if (v.name === undefined && !has('name')) bad('name', 'Для нового товара нужно название');
      if (v.priceKopecks === undefined && !has('price')) bad('price', 'Для нового товара нужна цена');
      if (v.category === undefined && !has('category')) bad('category', 'Для нового товара нужна категория');
    }

    // --- ссылки на категорию и бренд
    const willCreateCat: string[] = [];
    if (v.category !== undefined && verdict !== 'skip') {
      const res = resolveCategory(refs, v.category);
      if (res.kind === 'ambiguous') bad('category', res.message);
      else if (res.kind === 'missing') {
        if (options.unknownRefs === 'error') bad('category', `Категория «${v.category}» не найдена`);
        else {
          let chain = '';
          for (const name of res.missing) {
            chain += `>${foldText(name.trim())}`;
            willCreateCat.push(`${res.parentId ?? 0}|${chain}`);
          }
        }
      }
    }
    let willCreateBrand: string | null = null;
    if (typeof v.brand === 'string' && verdict !== 'skip' && !refs.brands.has(foldText(v.brand.trim()))) {
      if (options.unknownRefs === 'error') bad('brand', `Бренд «${v.brand}» не найден`);
      else willCreateBrand = foldText(v.brand.trim());
    }

    // --- старая цена должна быть больше цены к оплате
    if (verdict !== 'skip' && (v.priceKopecks !== undefined || v.oldPriceKopecks !== undefined)) {
      const price = v.priceKopecks ?? existing?.priceKopecks;
      const old = intent.oldPriceKopecks === undefined ? existing?.oldPriceKopecks : intent.oldPriceKopecks;
      if (price !== undefined && old !== null && old !== undefined && old <= price) bad('oldPrice', 'Старая цена должна быть больше цены');
    }

    // --- различия с сохранённым товаром
    let changes: string[] = [];
    let lockedSkipped: string[] = [];
    if (existing && verdict === 'update') {
      ({ changes, lockedSkipped } = diffExisting(db, existing, intent, refs, options));
      if (changes.length === 0) {
        verdict = 'skip';
        reason = lockedSkipped.length > 0 ? 'Изменения закреплены вручную' : 'Без изменений';
      }
    }

    const hasError = issues.length > 0;
    const out: PlannedRow = {
      rowNo: row.rowNo,
      verdict: hasError ? 'error' : verdict,
      name: v.name ?? existing?.name ?? null,
      key: keyText,
      productId: existingId,
      changes: hasError ? [] : changes,
      lockedSkipped,
      reason: hasError ? (issues[0]?.message ?? null) : reason,
      issues,
      intent,
    };
    if (!hasError && verdict !== 'skip') {
      for (const k of willCreateCat) newCategories.add(k);
      if (willCreateBrand) newBrands.add(willCreateBrand);
    }
    planned.push(out);
    allIssues.push(...issues);
  }

  const count = (x: Verdict) => planned.filter((r) => r.verdict === x).length;
  return {
    rows: planned,
    issues: allIssues,
    summary: {
      total: planned.length,
      create: count('create'),
      update: count('update'),
      skip: count('skip'),
      error: count('error'),
      lockedSkipped: planned.reduce((n, r) => n + r.lockedSkipped.length, 0),
      categoriesToCreate: newCategories.size,
      brandsToCreate: newBrands.size,
    },
  };
}

/** Название поля для показа («price» → «Цена»). */
export function fieldLabel(key: string): string {
  if (key.startsWith('attr:')) return `Характеристика ${key.slice(5)}`;
  return FIELD_BY_KEY.get(key)?.label ?? key;
}
