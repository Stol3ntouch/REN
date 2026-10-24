import type { ReactNode } from 'react';
import { ENTITY_FIELDS, type EntityKey, type FieldSpec } from '@/domain/content/fields';
import { FileUploader } from '@/ui/admin/kit/FileUploader';
import { FormField } from '@/ui/admin/kit/FormField';
import { SaveBar } from '@/ui/admin/kit/SaveBar';
import { SelectField } from '@/ui/admin/kit/SelectField';
import { TextAreaField } from '@/ui/admin/kit/TextAreaField';
import { Toggle } from '@/ui/admin/kit/Toggle';
import { UnsavedChangesGuard } from '@/ui/admin/kit/UnsavedChangesGuard';
import { ProductPicker, type PickedProduct } from './ProductPicker';

const MSK = 'Europe/Moscow';
const dateValue = (ms: unknown): string => (typeof ms === 'number' ? new Intl.DateTimeFormat('sv-SE', { timeZone: MSK }).format(new Date(ms)) : '');
const dateTimeValue = (ms: unknown): string => {
  if (typeof ms !== 'number') return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: MSK, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const rubles = (kopecks: unknown): string => (typeof kopecks === 'number' && kopecks > 0 ? (kopecks % 100 === 0 ? String(kopecks / 100) : (kopecks / 100).toFixed(2).replace('.', ',')) : '');

export type FieldOptions = Record<string, readonly { value: string; label: string }[]>;
export type FormPreviews = Record<string, { src: string; alt: string } | null>;

/** Значение поля для показа в форме (деньги — в рублях, даты — по Москве). */
function show(f: FieldSpec, record: Record<string, unknown>): unknown {
  const v = record[f.name];
  if (f.name === 'discountValue') return record.discountType === 'percent' ? (typeof v === 'number' && v > 0 ? String(v) : '') : rubles(v);
  if (f.kind === 'money') return rubles(v);
  if (f.kind === 'date') return dateValue(v);
  if (f.kind === 'datetime') return dateTimeValue(v);
  return v;
}

function Control({ f, id, record, options, previews, error, products }: { f: FieldSpec; id: string; record: Record<string, unknown>; options: FieldOptions; previews: FormPreviews; error?: string; products: PickedProduct[] }): ReactNode {
  const value = show(f, record);
  const str = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  switch (f.kind) {
    case 'bool':
      return <Toggle name={f.name} label={f.label} checked={value === true} />;
    case 'file':
      return <FileUploader key={f.name} name={f.name} label={f.label} value={previews[f.name]?.src ?? null} alt={previews[f.name]?.alt ?? ''} hint={f.hint} error={error} />;
    case 'textarea':
      return <TextAreaField id={id} name={f.name} label={f.label} hint={f.hint} error={error} required={f.required} maxLength={f.maxLength} rows={f.name === 'body' ? 14 : 3} defaultValue={str} />;
    case 'select':
      return <SelectField id={id} name={f.name} label={f.label} hint={f.hint} error={error} options={f.options ?? []} defaultValue={str || f.options?.[0]?.value} />;
    case 'refselect':
      return <SelectField id={id} name={f.name} label={f.label} hint={f.hint} error={error} placeholder="— не выбрано —" options={options[f.name] ?? []} defaultValue={str} />;
    case 'intlist': {
      if (f.name === 'productIds') return <ProductPicker name={f.name} initial={products} />;
      const chosen = Array.isArray(record[f.name]) ? (record[f.name] as number[]).map(String) : [];
      return (
        <div className="ak-field">
          <label className="ak-field__label" htmlFor={id}>
            {f.label}
          </label>
          <input type="hidden" name={`${f.name}__present`} value="1" />
          <select id={id} name={f.name} multiple size={8} defaultValue={chosen} aria-describedby={f.hint ? `${id}-hint` : undefined}>
            {(options[f.name] ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {f.hint ? (
            <p id={`${id}-hint`} className="ak-field__hint">
              {f.hint} Несколько — с Ctrl.
            </p>
          ) : null}
        </div>
      );
    }
    case 'date':
      return <FormField id={id} name={f.name} label={f.label} hint={f.hint} error={error} type="date" defaultValue={str} />;
    case 'datetime':
      return <FormField id={id} name={f.name} label={f.label} hint={f.hint} error={error} type="datetime-local" defaultValue={str} />;
    case 'int':
      return <FormField id={id} name={f.name} label={f.label} hint={f.hint} error={error} type="number" step={1} defaultValue={str} />;
    case 'money':
      return <FormField id={id} name={f.name} label={f.label} hint={f.hint} error={error} inputMode="decimal" defaultValue={str} />;
    default:
      return <FormField id={id} name={f.name} label={f.label} hint={f.hint} error={error} required={f.required} maxLength={f.maxLength} defaultValue={str} />;
  }
}

/**
 * Универсальная форма раздела: поля — из ENTITY_FIELDS (группы — отдельные карточки); отправка multipart на
 * /admin/content/save/<раздел>. Внизу SaveBar, несохранённые изменения охраняет UnsavedChangesGuard.
 */
export function ContentForm({
  entity,
  id,
  record = {},
  options = {},
  previews = {},
  products = [],
  fieldErrors = {},
  cancelHref,
  extra,
}: {
  entity: EntityKey;
  id?: number;
  record?: Record<string, unknown>;
  options?: FieldOptions;
  previews?: FormPreviews;
  products?: PickedProduct[];
  fieldErrors?: Record<string, string>;
  cancelHref: string;
  extra?: ReactNode;
}) {
  const formId = `content-form-${entity}`;
  const groups = new Map<string, FieldSpec[]>();
  for (const f of ENTITY_FIELDS[entity]) {
    const key = f.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return (
    <>
      <form id={formId} method="post" action={`/admin/content/save/${entity}`} encType="multipart/form-data" className="ak-content-form">
        {id !== undefined ? <input type="hidden" name="id" value={id} /> : null}
        {[...groups.entries()].map(([group, fields]) => (
          <section key={group || 'main'} className="ak-card" aria-labelledby={group ? `${formId}-${fields[0]?.name}-g` : undefined}>
            {group ? <h2 id={`${formId}-${fields[0]?.name}-g`}>{group}</h2> : null}
            <div className="ak-form-grid">
              {fields.map((f) => (
                <Control key={f.name} f={f} id={`${formId}-${f.name}`} record={record} options={options} previews={previews} error={fieldErrors[f.name]} products={products} />
              ))}
            </div>
          </section>
        ))}
        {extra}
        <SaveBar cancelHref={cancelHref} saveLabel={id === undefined ? 'Создать' : 'Сохранить изменения'} />
      </form>
      <UnsavedChangesGuard formId={formId} />
    </>
  );
}
