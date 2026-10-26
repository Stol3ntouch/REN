import { ConfirmButton, SelectField, firstParam, type SearchParams } from '@/ui/admin/kit';
import { filterToParams, parseProductFilter } from '@/domain/catalog/products-list';
import { MAX_BULK } from '../../../_lib/product-list-ops';
import { bulkDeleteProductsAction } from './actions';

export type PanelOptions = { categories: readonly { id: number; label: string }[]; brands: readonly { id: number; name: string }[] };

const OPS = [
  { value: 'publish', label: 'Опубликовать' },
  { value: 'unpublish', label: 'Снять с публикации' },
  { value: 'hide', label: 'Скрыть с сайта' },
  { value: 'show', label: 'Показать на сайте' },
  { value: 'move', label: 'Переместить в категорию (основная)' },
  { value: 'addCategory', label: 'Добавить в дополнительную категорию' },
  { value: 'brand', label: 'Сменить бренд' },
  { value: 'new:1', label: 'Пометить «Новинка»' },
  { value: 'new:0', label: 'Снять «Новинка»' },
  { value: 'featured:1', label: 'Пометить «Рекомендуемый»' },
  { value: 'featured:0', label: 'Снять «Рекомендуемый»' },
  { value: 'promo:1', label: 'Пометить «Акция»' },
  { value: 'promo:0', label: 'Снять «Акция»' },
];

/**
 * Панель массовых действий (показывается, когда отмечена хотя бы одна строка). Отмеченные id уходят полем `ids` (атрибут form у чекбоксов),
 * «все по фильтру» — флажок scope=filter с числом (expected) и текущим фильтром (qs): сервер сверяет число и выполняет до 5000 за раз.
 */
export function BulkPanel({
  formId,
  canWrite,
  canDelete,
  total,
  back,
  params,
  options,
  bulkAction,
}: {
  formId: string;
  canWrite: boolean;
  canDelete: boolean;
  total: number;
  back: string;
  params: SearchParams;
  options: PanelOptions;
  bulkAction: (form: FormData) => Promise<never>;
}) {
  const qs = new URLSearchParams(filterToParams(parseProductFilter(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, firstParam(v)]))))).toString();
  return (
    <form id={formId} action={bulkAction} className="pl-bulk" aria-label="Массовые действия над товарами">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="qs" value={qs} />
      <input type="hidden" name="expected" value={total} />
      {canWrite ? (
        <>
          <SelectField name="op" label="Действие" options={OPS} placeholder="Выберите действие" />
          <SelectField name="categoryId" label="Категория" placeholder="—" options={options.categories.map((c) => ({ value: String(c.id), label: c.label }))} />
          <SelectField name="brandId" label="Бренд" placeholder="—" options={[{ value: 'none', label: 'Без бренда' }, ...options.brands.map((b) => ({ value: String(b.id), label: b.name }))]} />
        </>
      ) : null}
      <label className="pl-bulk__scope">
        <input type="checkbox" name="scope" value="filter" disabled={total > MAX_BULK} />
        <span>
          Применить ко всем {total} товарам по текущему фильтру{total > MAX_BULK ? ` (не больше ${MAX_BULK} за раз — сузьте фильтр)` : ''}
        </span>
      </label>
      {canWrite ? (
        <ConfirmButton title="Применить действие?" description="Действие применится к отмеченным товарам (или ко всем по фильтру, если отмечен флажок). Это изменит их на сайте." confirmLabel="Применить" tone="default" className="ak-btn ak-btn--primary">
          Применить
        </ConfirmButton>
      ) : null}
      {canDelete ? (
        <ConfirmButton
          formAction={bulkDeleteProductsAction}
          title="Удалить выбранные товары?"
          description="Удаляются только товары без заказов, остальные будут пропущены. Действие нельзя отменить."
          confirmLabel="Удалить"
        >
          Удалить выбранные
        </ConfirmButton>
      ) : null}
    </form>
  );
}
