import { ATTRIBUTE_TYPE_LABELS, ATTRIBUTE_TYPES } from '@/domain/catalog/attributes';
import type { AttributeDef } from '@/server/db/repositories/attributes';
import type { CategoryRow } from '@/server/db/repositories/categories';
import { FormField, SaveBar, SelectField, TextAreaField, UnsavedChangesGuard } from '@/ui/admin/kit';
import { createAttributeAction, updateAttributeAction } from './actions';

/** Форма характеристики. Тип можно сменить, если все сохранённые значения ему соответствуют (проверяет сервер). */
export function AttributeForm({ attribute, categories, hint }: { attribute: AttributeDef | null; categories: CategoryRow[]; hint?: string }) {
  return (
    <form id="attribute-form" action={attribute ? updateAttributeAction : createAttributeAction} className="ak-card ak-form-grid">
      <UnsavedChangesGuard formId="attribute-form" />
      {attribute ? <input type="hidden" name="id" value={attribute.id} /> : null}
      <FormField name="name" label="Название" required maxLength={200} defaultValue={attribute?.name ?? ''} />
      <FormField name="code" label="Системный код" maxLength={64} defaultValue={attribute?.code ?? ''} hint="Латиница, цифры и «_». Пусто — из названия." />
      <SelectField name="type" label="Тип значения" required defaultValue={attribute?.type ?? 'string'} options={ATTRIBUTE_TYPES.map((t) => ({ value: t, label: ATTRIBUTE_TYPE_LABELS[t] }))} hint={hint} />
      <FormField name="unit" label="Единица измерения" maxLength={30} defaultValue={attribute?.unit ?? ''} placeholder="кг, мм, л…" />
      <TextAreaField name="allowedValues" label="Допустимые значения (для списка)" rows={5} hint="По одному в строке. Только для типа «Список значений»." defaultValue={(attribute?.allowedValues ?? []).join('\n')} />
      <div className="ak-field">
        <label className="ak-field__label" htmlFor="f-categoryIds">Ограничение по категориям</label>
        <select id="f-categoryIds" name="categoryIds" multiple size={8} defaultValue={(attribute?.categoryIds ?? []).map(String)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="ak-field__hint">Ничего не выбрано — характеристика применима ко всем категориям (выбранные действуют вместе с подкатегориями).</p>
      </div>
      <FormField name="sort" label="Порядок отображения" type="number" step={1} defaultValue={attribute?.sort ?? 0} />
      <label className="ak-check">
        <input type="checkbox" name="required" defaultChecked={attribute?.required ?? false} /> Обязательная
      </label>
      <label className="ak-check">
        <input type="checkbox" name="filterable" defaultChecked={attribute?.filterable ?? true} /> Использовать в фильтрах
      </label>
      <label className="ak-check">
        <input type="checkbox" name="comparable" defaultChecked={attribute?.comparable ?? true} /> Использовать в сравнении
      </label>
      <SaveBar cancelHref="/admin/catalog/attributes" />
    </form>
  );
}
