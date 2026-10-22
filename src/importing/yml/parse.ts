import { Buffer } from 'node:buffer';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { sanitizeDescription } from './sanitize';
import { lastUrlSegment } from './slug';
import { MAX_IMAGES_PER_PRODUCT, MAX_IMPORT_BYTES, type ParsedAttribute, type ParsedCategory, type ParsedOffer, type ParsedYml, type RowError } from './types';

/** Файл целиком непригоден (слишком большой, не XML, не YML). Строки с ошибками сюда не относятся. */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false, // артикулы и id остаются строками
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'category' || name === 'offer' || name === 'picture' || name === 'param',
  // В YML нет пользовательских сущностей (они отклоняются заранее); лимиты — только от аномалий.
  processEntities: { enabled: true, maxTotalExpansions: 5_000_000, maxExpandedLength: 100_000_000, maxEntityCount: 100 },
});

function text(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    const t = (v as Node)['#text'];
    if (typeof t === 'string') return t.trim();
  }
  return '';
}

/** «18990.00000000» → 1899000 копеек; null, если цена пустая, нечисловая или не положительная. */
export function parsePriceKopecks(raw: string): number | null {
  const s = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const kopecks = Math.round(Number(s) * 100);
  return Number.isSafeInteger(kopecks) && kopecks > 0 && kopecks < 1e13 ? kopecks : null;
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined ? [] : [v];
}

function parseCategories(raw: unknown[], errors: RowError[]): ParsedCategory[] {
  const rows: ParsedCategory[] = [];
  const seen = new Set<string>();
  raw.forEach((c, position) => {
    const node = (c && typeof c === 'object' ? c : {}) as Node;
    const externalId = text(node['@_id']);
    const name = text(node);
    const parent = text(node['@_parentId']);
    if (!externalId) return void errors.push({ kind: 'category', position, message: `Категория №${position + 1}: нет id` });
    if (!name) return void errors.push({ kind: 'category', externalId, position, message: `Категория ${externalId}: пустое название` });
    if (seen.has(externalId)) return void errors.push({ kind: 'category', externalId, position, message: `Категория ${externalId}: повтор id в файле` });
    seen.add(externalId);
    rows.push({ externalId, parentExternalId: parent || null, name, position });
  });

  // Родитель должен существовать и не образовывать цикл; иначе категория отбрасывается вместе с потомками.
  const byId = new Map(rows.map((r) => [r.externalId, r]));
  const bad = new Map<string, string>();
  for (const r of rows) {
    if (!r.parentExternalId) continue;
    if (r.parentExternalId === r.externalId) {
      bad.set(r.externalId, 'категория указана родителем самой себя');
      continue;
    }
    const chain = new Set([r.externalId]);
    let cur: ParsedCategory | undefined = byId.get(r.parentExternalId);
    if (!cur) bad.set(r.externalId, `родительская категория ${r.parentExternalId} не найдена`);
    while (cur) {
      if (chain.has(cur.externalId)) {
        bad.set(r.externalId, 'цикл в дереве категорий');
        break;
      }
      chain.add(cur.externalId);
      if (!cur.parentExternalId) break;
      const next: ParsedCategory | undefined = byId.get(cur.parentExternalId);
      if (!next) bad.set(r.externalId, `родитель ${cur.parentExternalId} не найден`);
      cur = next;
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows) {
      if (!bad.has(r.externalId) && r.parentExternalId && bad.has(r.parentExternalId)) {
        bad.set(r.externalId, `родительская категория ${r.parentExternalId} отклонена`);
        changed = true;
      }
    }
  }
  for (const r of rows) {
    const why = bad.get(r.externalId);
    if (why) errors.push({ kind: 'category', externalId: r.externalId, position: r.position, message: `Категория ${r.externalId}: ${why}` });
  }
  return rows.filter((r) => !bad.has(r.externalId));
}

function parseOffer(node: Node, position: number, errors: RowError[], seen: Set<string>): ParsedOffer | null {
  const externalId = text(node['@_id']);
  const fail = (message: string) => {
    errors.push({ kind: 'offer', ...(externalId ? { externalId } : {}), position, message });
    return null;
  };
  const label = externalId ? `Товар ${externalId}` : `Товар №${position + 1}`;
  if (!externalId) return fail(`${label}: нет id`);
  if (seen.has(externalId)) return fail(`${label}: повтор id в файле, строка пропущена`);
  const name = text(node['name']);
  if (!name) return fail(`${label}: нет названия`);
  const categoryExternalId = text(node['categoryId']);
  if (!categoryExternalId) return fail(`${label}: не указана категория`);
  const priceRaw = text(node['price']);
  const priceKopecks = parsePriceKopecks(priceRaw);
  if (priceKopecks === null) return fail(priceRaw === '' ? `${label}: пустая цена` : `${label}: цена «${priceRaw}» не число или не больше нуля`);
  seen.add(externalId);

  const pictures: string[] = [];
  for (const p of asList(node['picture'])) {
    const url = text(p);
    if (!url) continue;
    if (!isHttpUrl(url)) {
      errors.push({ kind: 'image', externalId, position, message: `${label}: ссылка на фото отклонена (нужен http/https): ${url.slice(0, 80)}` });
      continue;
    }
    if (pictures.includes(url)) continue;
    if (pictures.length >= MAX_IMAGES_PER_PRODUCT) {
      errors.push({ kind: 'image', externalId, position, message: `${label}: больше ${MAX_IMAGES_PER_PRODUCT} фото, лишние отброшены` });
      break;
    }
    pictures.push(url);
  }

  const attributes: ParsedAttribute[] = [];
  for (const p of asList(node['param'])) {
    const pn = (p && typeof p === 'object' ? p : {}) as Node;
    const pname = text(pn['@_name']);
    const value = text(p);
    if (pname && value) attributes.push({ name: pname, value });
  }

  const descRaw = text(node['item_description']) || text(node['description']);
  const available = text(node['@_available']).toLowerCase();
  return {
    externalId,
    name,
    sku: text(node['model']) || null,
    categoryExternalId,
    priceKopecks,
    inStock: available !== 'false' && available !== '0',
    description: descRaw ? sanitizeDescription(descRaw) : null,
    slugHint: lastUrlSegment(text(node['url'])),
    pictures,
    attributes,
    position,
  };
}

/**
 * Разбирает YML (Яндекс.Маркет) в категории и товары. Битые строки не прерывают разбор —
 * они попадают в `errors`. Файл целиком непригоден → ImportFileError.
 */
export function parseYml(xml: string): ParsedYml {
  if (typeof xml !== 'string' || xml.trim() === '') throw new ImportFileError('Файл пустой');
  if (Buffer.byteLength(xml, 'utf8') > MAX_IMPORT_BYTES) throw new ImportFileError('Файл больше 20 МБ');
  const body = xml.replace(/^﻿/, '').trimStart();
  if (!body.startsWith('<')) throw new ImportFileError('Файл не является XML');
  if (/<!ENTITY/i.test(body)) throw new ImportFileError('Пользовательские сущности в XML не допускаются');
  const valid = XMLValidator.validate(body);
  if (valid !== true) throw new ImportFileError(`Файл не является корректным XML: ${valid.err.msg}`);

  const doc = parser.parse(body) as Node;
  const root = doc['yml_catalog'];
  const shop = root && typeof root === 'object' ? ((root as Node)['shop'] as Node | undefined) : undefined;
  if (!shop || typeof shop !== 'object') throw new ImportFileError('Файл не похож на YML: нет yml_catalog/shop');

  const errors: RowError[] = [];
  const catsNode = shop['categories'];
  const offersNode = shop['offers'];
  const categories = parseCategories(catsNode && typeof catsNode === 'object' ? asList((catsNode as Node)['category']) : [], errors);
  const seen = new Set<string>();
  const offers: ParsedOffer[] = [];
  const rawOffers = offersNode && typeof offersNode === 'object' ? asList((offersNode as Node)['offer']) : [];
  rawOffers.forEach((o, position) => {
    const parsed = parseOffer((o && typeof o === 'object' ? o : {}) as Node, position, errors, seen);
    if (parsed) offers.push(parsed);
  });
  return { categories, offers, errors };
}
