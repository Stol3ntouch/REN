import { z } from 'zod';
import { slugify } from '@/importing/yml/slug';
import { AVAILABILITY_VALUES, type Availability } from '@/server/db/repositories/stock';
import { ValidationError, type FieldErrors } from '@/server/http/errors';
import { zodToValidation } from './validation';
import { isHttpUrl } from './validation';

export { AVAILABILITY_VALUES, type Availability };

export const MAX_KOPECKS = 10_000_000_000; // 100 млн ₽
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_EXTRA_CATEGORIES = 30;

export const AVAILABILITY_LABELS: Readonly<Record<Availability, string>> = {
  in_stock: 'В наличии',
  out_of_stock: 'Нет в наличии',
  preorder: 'Под заказ',
  discontinued: 'Снят с продажи',
};

/** Выбор статуса наличия в форме: «авто» (из остатка) или явное значение. */
export type AvailabilityChoice = 'auto' | Availability;
export const AVAILABILITY_CHOICES: readonly AvailabilityChoice[] = ['auto', ...AVAILABILITY_VALUES];

const kopecks = (label: string) =>
  z
    .number({ error: `${label}: нужно число` })
    .int(`${label}: целое число копеек`)
    .min(0, `${label}: не может быть отрицательной`)
    .max(MAX_KOPECKS, `${label}: слишком большая сумма`);

const text = (max: number, label: string) =>
  z
    .string({ error: `${label}: нужен текст` })
    .trim()
    .max(max, `${label}: не длиннее ${max} символов`)
    .transform((v) => (v === '' ? null : v));

const id = (label: string) => z.number({ error: `${label}: нужно число` }).int(`${label}: нужно целое число`).positive(`${label}: выберите значение из списка`);

const int0 = (label: string) => z.number({ error: `${label}: нужно число` }).int(`${label}: нужно целое число`).min(0, `${label}: не может быть отрицательным`).max(1_000_000_000, `${label}: слишком большое число`);

/**
 * Поля карточки товара. Обязательны название, основная категория и цена; остальные при создании получают значения по умолчанию,
 * а при правке не указанные (undefined) остаются как были. Остаток и резерв здесь только «желаемые»: меняет их сервис stock.
 */
export const productInputSchema = z
  .object({
    name: z.string({ error: 'Укажите название' }).trim().min(1, 'Укажите название').max(300, 'Название: не длиннее 300 символов'),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .max(100, 'Slug: не длиннее 100 символов')
      .refine((v) => v === '' || SLUG_PATTERN.test(v), 'Slug: только латиница, цифры и дефисы')
      .optional(),
    sku: text(100, 'Артикул').optional(),
    barcode: text(64, 'Штрихкод')
      .refine((v) => v === null || /^[0-9A-Za-z-]{4,64}$/.test(v), 'Штрихкод: от 4 символов, только цифры, латиница и дефис')
      .optional(),
    shortDescription: text(500, 'Краткое описание').optional(),
    description: z.string({ error: 'Описание: нужен текст' }).max(20_000, 'Описание: не длиннее 20 000 символов').nullable().optional(),
    categoryId: id('Категория'),
    extraCategoryIds: z.array(id('Дополнительная категория')).max(MAX_EXTRA_CATEGORIES, `Дополнительных категорий не больше ${MAX_EXTRA_CATEGORIES}`).optional(),
    brandId: id('Бренд').nullable().optional(),
    priceKopecks: kopecks('Цена'),
    discountPriceKopecks: kopecks('Скидочная цена').nullable().optional(),
    oldPriceKopecks: kopecks('Старая цена').nullable().optional(),
    purchasePriceKopecks: kopecks('Закупочная цена').nullable().optional(),
    availability: z.enum(AVAILABILITY_CHOICES as [AvailabilityChoice, ...AvailabilityChoice[]], { error: 'Неизвестный статус наличия' }).optional(),
    stockQty: int0('Остаток').optional(),
    reservedQty: int0('Резерв').optional(),
    stockReason: z.string().trim().max(300, 'Причина: не длиннее 300 символов').optional(),
    published: z.boolean().optional(),
    hidden: z.boolean().optional(),
    featured: z.boolean().optional(),
    isNew: z.boolean().optional(),
    isPromo: z.boolean().optional(),
    seoTitle: text(200, 'SEO Title').optional(),
    seoDescription: text(500, 'SEO Description').optional(),
    canonicalUrl: text(500, 'Canonical')
      .refine((v) => v === null || isHttpUrl(v), 'Canonical: адрес должен начинаться с http:// или https://')
      .optional(),
    indexable: z.boolean().optional(),
    attributes: z
      .array(z.object({ attributeId: id('Характеристика'), value: z.string({ error: 'Значение: нужен текст' }) }).strict())
      .max(500, 'Слишком много характеристик')
      .optional(),
  })
  .strict();

export type ProductInput = z.input<typeof productInputSchema>;
export type ProductParsed = z.output<typeof productInputSchema>;

export function parseProductInput(input: unknown): ProductParsed {
  const parsed = productInputSchema.safeParse(input);
  const priceErrors = pricesProblems(input);
  if (!parsed.success) {
    const err = zodToValidation(parsed.error);
    for (const [k, v] of Object.entries(priceErrors)) if (!(k in err.fields)) err.fields[k] = v;
    throw err;
  }
  if (Object.keys(priceErrors).length > 0) throw new ValidationError(Object.values(priceErrors)[0]?.[0] ?? 'Проверьте цены', priceErrors);
  return parsed.data;
}

type Money = number | null | undefined;
const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Взаимные ограничения цен: скидочная меньше обычной, старая больше цены к оплате. Проверяются по тем значениям, что известны. */
export function pricesProblems(input: unknown): FieldErrors {
  const o = (input ?? {}) as { priceKopecks?: Money; discountPriceKopecks?: Money; oldPriceKopecks?: Money };
  return priceRules({ price: isMoney(o.priceKopecks) ? o.priceKopecks : undefined, discount: o.discountPriceKopecks, old: o.oldPriceKopecks });
}

export function priceRules(p: { price: number | undefined; discount: Money; old: Money }): FieldErrors {
  const errors: FieldErrors = {};
  if (p.price === undefined) return errors;
  if (isMoney(p.discount) && p.discount >= p.price) errors.discountPriceKopecks = ['Скидочная цена должна быть меньше обычной'];
  const unit = isMoney(p.discount) && p.discount < p.price ? p.discount : p.price;
  if (isMoney(p.old) && p.old <= unit) errors.oldPriceKopecks = ['Старая цена должна быть больше цены к оплате'];
  return errors;
}

/** Slug товара: транслитерация названия, свободный среди занятых (base, base-2, base-3…). */
export function productSlugFrom(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name) || 'tovar';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Рубли из формы («1 250,50») → копейки; пусто → null; ошибка → NaN. */
export function rublesToKopecks(raw: string): number | null {
  const t = raw.replace(/[\s ]/g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
