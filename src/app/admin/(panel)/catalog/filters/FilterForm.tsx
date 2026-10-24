import { FILTER_KIND_LABELS, FILTER_KINDS, FILTER_WIDGET_LABELS, FILTER_WIDGETS, DEFAULT_MAX_VALUES, DEFAULT_MIN_PRODUCTS } from '@/domain/catalog/filters';
import type { AttributeDef } from '@/server/db/repositories/attributes';
import type { CategoryRow } from '@/server/db/repositories/categories';
import type { FilterListRow } from '@/server/db/repositories/filters';
import { FormField, SaveBar, SelectField, UnsavedChangesGuard } from '@/ui/admin/kit';
import { createFilterAction, updateFilterAction } from './actions';

type AttrOption = Pick<AttributeDef, 'id' | 'name' | 'type'>;

/**
 * Форма фильтра. Сочетания проверяет сервер: фильтр характеристики требует характеристику, диапазон — только для цены
 * и числовой характеристики. Пороги «минимум товаров / максимум значений» — прежнее правило витрины (3 и 30).
 */
export function FilterForm({ filter, attributes, categories }: { filter: FilterListRow | null; attributes: AttrOption[]; categories: CategoryRow[] }) {
  return (
    <form id="filter-form" action={filter ? updateFilterAction : createFilterAction} className="ak-card ak-form-grid">
      <UnsavedChangesGuard formId="filter-form" />
      {filter ? <input type="hidden" name="id" value={filter.id} /> : null}
      <SelectField name="kind" label="Вид фильтра" required defaultValue={filter?.kind ?? 'attribute'} options={FILTER_KINDS.map((k) => ({ value: k, label: FILTER_KIND_LABELS[k] }))} />
      <SelectField
        name="attributeId"
        label="Характеристика"
        placeholder="Не выбрана"
        defaultValue={filter?.attributeId ? String(filter.attributeId) : ''}
        hint="Только для вида «Характеристика»."
        options={attributes.map((a) => ({ value: String(a.id), label: a.name }))}
      />
      <FormField name="label" label="Название на сайте" required maxLength={100} defaultValue={filter?.label ?? ''} />
      <SelectField name="widget" label="Отображение" required defaultValue={filter?.widget ?? 'checkbox'} options={FILTER_WIDGETS.map((w) => ({ value: w, label: FILTER_WIDGET_LABELS[w] }))} hint="Диапазон — для цены и числовой характеристики." />
      <FormField name="sort" label="Порядок показа" type="number" step={1} defaultValue={filter?.sort ?? 100} />
      <FormField name="minProducts" label="Минимум товаров в категории" type="number" min={1} max={1000} defaultValue={filter?.config.minProducts ?? ''} placeholder={String(DEFAULT_MIN_PRODUCTS)} hint="Характеристика показывается, если она есть не меньше чем у стольких товаров." />
      <FormField name="maxValues" label="Максимум значений" type="number" min={1} max={500} defaultValue={filter?.config.maxValues ?? ''} placeholder={String(DEFAULT_MAX_VALUES)} hint="Если различных значений больше, фильтр не показывается." />
      <div className="ak-field">
        <label className="ak-field__label" htmlFor="f-categoryIds">Категории</label>
        <select id="f-categoryIds" name="categoryIds" multiple size={8} defaultValue={(filter?.categoryIds ?? []).map(String)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="ak-field__hint">Ничего не выбрано — фильтр показывается во всех категориях (выбранные действуют вместе с подкатегориями).</p>
      </div>
      <label className="ak-check">
        <input type="checkbox" name="enabled" defaultChecked={filter?.enabled ?? true} /> Включён
      </label>
      <SaveBar cancelHref="/admin/catalog/filters" />
    </form>
  );
}
