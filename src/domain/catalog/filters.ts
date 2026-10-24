import { z } from 'zod';
import { FILTER_KINDS, FILTER_WIDGETS, type FilterKind, type FilterWidget } from '@/server/db/repositories/filters';

export { FILTER_KINDS, FILTER_WIDGETS };
export type { FilterKind, FilterWidget };

export const FILTER_KIND_LABELS: Record<FilterKind, string> = {
  price: 'Цена',
  brand: 'Бренд',
  stock: 'Наличие',
  attribute: 'Характеристика',
  category: 'Подкатегория',
};
export const FILTER_WIDGET_LABELS: Record<FilterWidget, string> = {
  checkbox: 'Флажки',
  range: 'Диапазон',
  select: 'Выпадающий список',
};

export const DEFAULT_MIN_PRODUCTS = 3;
export const DEFAULT_MAX_VALUES = 30;

export const filterConfigSchema = z
  .object({
    minProducts: z.number().int('Минимум товаров: целое число').min(1, 'Минимум товаров: от 1').max(1000, 'Минимум товаров: до 1000').optional(),
    maxValues: z.number().int('Максимум значений: целое число').min(1, 'Максимум значений: от 1').max(500, 'Максимум значений: до 500').optional(),
  })
  .strict();

export const filterSchema = z
  .object({
    kind: z.enum(FILTER_KINDS, { error: 'Выберите вид фильтра' }),
    attributeId: z.number().int().positive().nullable(),
    label: z.string({ error: 'Укажите название' }).trim().min(1, 'Укажите название').max(100, 'Название: не длиннее 100 символов'),
    widget: z.enum(FILTER_WIDGETS, { error: 'Выберите вид отображения' }),
    sort: z.number({ error: 'Порядок: целое число' }).int('Порядок: целое число').min(-100000).max(100000),
    enabled: z.boolean(),
    config: filterConfigSchema,
    categoryIds: z.array(z.number().int().positive()).max(500, 'Слишком много категорий'),
  })
  .strict();

export type FilterInput = z.input<typeof filterSchema>;
export type FilterParsed = z.output<typeof filterSchema>;

/** Характеристика, к которой привязан фильтр (для проверки сочетания). */
export type FilterAttributeInfo = { type: string; filterable: boolean };

/** Допустимые виджеты для вида фильтра (и типа характеристики). */
export function allowedWidgets(kind: FilterKind, attributeType: string | null): FilterWidget[] {
  switch (kind) {
    case 'price':
      return ['range'];
    case 'stock':
      return ['checkbox'];
    case 'brand':
    case 'category':
      return ['checkbox', 'select'];
    case 'attribute':
      return attributeType === 'number' ? ['range', 'checkbox', 'select'] : ['checkbox', 'select'];
  }
}

/**
 * Проверка корректности конфигурации фильтра: список понятных ошибок (пустой — конфигурация верна).
 * Правила: у фильтра характеристики характеристика обязательна, у остальных видов её быть не должно;
 * диапазон — только для цены и числовой характеристики; характеристика должна участвовать в фильтрах.
 */
export function validateFilterConfig(f: Pick<FilterParsed, 'kind' | 'attributeId' | 'widget' | 'config'>, attribute: FilterAttributeInfo | null): string[] {
  const errors: string[] = [];
  if (f.kind === 'attribute') {
    if (f.attributeId === null) errors.push('Для фильтра характеристики выберите характеристику');
    else if (!attribute) errors.push('Выбранная характеристика не найдена');
    else if (!attribute.filterable) errors.push('Характеристика не участвует в фильтрах: включите у неё «Использовать в фильтрах»');
  } else if (f.attributeId !== null) {
    errors.push('Характеристика выбирается только у фильтра вида «Характеристика»');
  }
  const allowed = allowedWidgets(f.kind, f.kind === 'attribute' ? (attribute?.type ?? null) : null);
  if (!allowed.includes(f.widget)) {
    errors.push(
      f.widget === 'range'
        ? 'Диапазон возможен только для цены и числовой характеристики'
        : `Для вида «${FILTER_KIND_LABELS[f.kind]}» нельзя выбрать «${FILTER_WIDGET_LABELS[f.widget]}»`,
    );
  }
  return errors;
}

/** Фильтр показывается в категории: нет ограничения или категория (либо её предок) в списке. */
export function filterAppliesToCategory(restriction: readonly number[], ancestorsAndSelf: ReadonlySet<number> | null): boolean {
  if (restriction.length === 0) return true;
  return ancestorsAndSelf !== null && restriction.some((c) => ancestorsAndSelf.has(c));
}
