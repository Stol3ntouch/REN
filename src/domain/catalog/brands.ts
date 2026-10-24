import { z } from 'zod';
import { slugify } from '@/importing/yml/slug';
import { isHttpUrl } from './validation';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const optionalText = (max: number, label: string) =>
  z
    .string({ error: `${label}: нужен текст` })
    .trim()
    .max(max, `${label}: не длиннее ${max} символов`)
    .transform((v) => (v === '' ? null : v));

/** Поля формы бренда (без логотипа). Slug пустой — берётся из названия. */
export const brandSchema = z
  .object({
    name: z.string({ error: 'Укажите название' }).trim().min(1, 'Укажите название').max(120, 'Название: не длиннее 120 символов'),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .max(100, 'Slug: не длиннее 100 символов')
      .refine((v) => v === '' || SLUG_PATTERN.test(v), 'Slug: только латиница, цифры и дефисы'),
    description: optionalText(5000, 'Описание'),
    siteUrl: optionalText(300, 'Сайт').refine((v) => v === null || isHttpUrl(v), 'Сайт: адрес должен начинаться с http:// или https://'),
    published: z.boolean(),
    sort: z.number({ error: 'Позиция: целое число' }).int('Позиция: целое число').min(-100000, 'Позиция: от -100000').max(100000, 'Позиция: до 100000'),
    seoTitle: optionalText(200, 'SEO Title'),
    seoDescription: optionalText(500, 'SEO Description'),
  })
  .strict();

export type BrandInput = z.input<typeof brandSchema>;
export type BrandFieldsParsed = z.output<typeof brandSchema>;

/** Slug бренда: заданный или из названия (транслитерация); свободный среди занятых. */
export function brandSlug(slug: string, name: string, taken: ReadonlySet<string>): string {
  const base = slug !== '' ? slug : slugify(name) || 'brand';
  if (slug !== '') return base;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
