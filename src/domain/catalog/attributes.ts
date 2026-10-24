import { z } from 'zod';
import { slugify } from '@/importing/yml/slug';
import { ATTRIBUTE_TYPES, type AttributeType } from './attribute-types';

export * from './attribute-types';

export const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
export const MAX_ALLOWED_VALUES = 500;

const optionalText = (max: number, label: string) =>
  z
    .string({ error: `${label}: нужен текст` })
    .trim()
    .max(max, `${label}: не длиннее ${max} символов`)
    .transform((v) => (v === '' ? null : v));

/** Системный код из названия: латиница, цифры и «_», начинается с буквы. */
export function attributeCodeFromName(name: string): string {
  const base = slugify(name).replace(/-/g, '_');
  if (base === '') return 'attr';
  return /^[a-z]/.test(base) ? base.slice(0, 64) : `a_${base}`.slice(0, 64);
}

export const attributeSchema = z
  .object({
    name: z.string({ error: 'Укажите название' }).trim().min(1, 'Укажите название').max(200, 'Название: не длиннее 200 символов'),
    code: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === '' || CODE_PATTERN.test(v), 'Код: латиница, цифры и «_», начинается с буквы, 2–64 символа'),
    type: z.enum(ATTRIBUTE_TYPES, { error: 'Выберите тип значения' }),
    unit: optionalText(30, 'Единица измерения'),
    required: z.boolean(),
    filterable: z.boolean(),
    comparable: z.boolean(),
    sort: z.number({ error: 'Порядок: целое число' }).int('Порядок: целое число').min(-100000).max(100000),
    categoryIds: z.array(z.number().int().positive()).max(500, 'Слишком много категорий'),
    allowedValues: z.array(z.string().trim().min(1).max(200, 'Допустимое значение: не длиннее 200 символов')).max(MAX_ALLOWED_VALUES, `Допустимых значений не больше ${MAX_ALLOWED_VALUES}`),
  })
  .strict()
  .superRefine((v, ctx) => {
    const lower = v.allowedValues.map((s) => s.toLowerCase());
    if (new Set(lower).size !== lower.length) ctx.addIssue({ code: 'custom', path: ['allowedValues'], message: 'Допустимые значения повторяются' });
    if (v.type === 'list' && v.allowedValues.length === 0) ctx.addIssue({ code: 'custom', path: ['allowedValues'], message: 'Для списка укажите допустимые значения' });
    if (v.type !== 'list' && v.allowedValues.length > 0) ctx.addIssue({ code: 'custom', path: ['allowedValues'], message: 'Допустимые значения задаются только для типа «Список значений»' });
    if (v.unit !== null && (v.type === 'boolean' || v.type === 'date')) ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Единица измерения не применима к этому типу' });
  });

export type AttributeInput = z.input<typeof attributeSchema>;
export type AttributeParsed = z.output<typeof attributeSchema>;

/** Применима ли характеристика к категории: нет ограничения или категория (либо её предок) в списке. */
export function appliesToCategory(restriction: readonly number[], ancestorsAndSelf: ReadonlySet<number>): boolean {
  return restriction.length === 0 || restriction.some((c) => ancestorsAndSelf.has(c));
}

/** Категория и все её предки (по карте id → parentId). Цикл в данных не зацикливает. */
export function ancestorsOf(categoryId: number, parents: ReadonlyMap<number, number | null>): Set<number> {
  const out = new Set<number>();
  for (let cur: number | null | undefined = categoryId; cur != null && !out.has(cur); cur = parents.get(cur)) out.add(cur);
  return out;
}

/** Подсказка по существующим данным: какой тип подходит всем значениям. Пустая выборка → string. */
export function suggestType(values: readonly string[]): AttributeType {
  if (values.length === 0) return 'string';
  const all = (f: (v: string) => boolean) => values.every(f);
  if (all((v) => /^-?\d+([.,]\d+)?$/.test(v.replace(/[\s ]/g, '')))) return 'number';
  if (all((v) => ['да', 'нет'].includes(v.trim().toLowerCase()))) return 'boolean';
  if (all((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{2}\.\d{2}\.\d{4}$/.test(v))) return 'date';
  return 'string';
}
