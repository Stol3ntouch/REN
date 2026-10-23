import { ENTITY_FIELDS, type EntityKey, type FieldSpec } from '@/domain/content/fields';

const MSK = 'Europe/Moscow';
const dateValue = (ms: unknown): string => (typeof ms === 'number' ? new Intl.DateTimeFormat('sv-SE', { timeZone: MSK }).format(new Date(ms)) : '');

/** Значения «по умолчанию» новой записи: флаги показа включены только у слайда, остальное выключено до проверки. */
const NEW_DEFAULTS: Partial<Record<EntityKey, Record<string, unknown>>> = { slides: { active: true } };

function Field({ f, id, record, preview }: { f: FieldSpec; id: string; record: Record<string, unknown>; preview?: { src: string; alt: string } | null }) {
  const value = record[f.name];
  const hint = f.hint ? <p className="adm-hint" id={`${id}-hint`}>{f.hint}</p> : null;
  const describedBy = f.hint ? `${id}-hint` : undefined;

  if (f.kind === 'bool') {
    return (
      <label className="adm-check">
        <input type="checkbox" name={f.name} defaultChecked={value === true} /> {f.label}
      </label>
    );
  }
  if (f.kind === 'file') {
    return (
      <div className="adm-field">
        <label htmlFor={id}>{f.label}</label>
        <input id={id} name={f.name} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={describedBy} />
        {hint}
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- предпросмотр загруженного файла */}
            <img className="adm-preview" src={preview.src} alt={preview.alt} />
            <label className="adm-check">
              <input type="checkbox" name={`${f.name}Remove`} /> Удалить изображение
            </label>
          </>
        ) : null}
      </div>
    );
  }
  const common = { id, name: f.name, required: f.required, maxLength: f.maxLength, 'aria-describedby': describedBy } as const;
  return (
    <div className="adm-field">
      <label htmlFor={id}>
        {f.label}
        {f.required ? ' *' : ''}
      </label>
      {f.kind === 'textarea' ? (
        <textarea {...common} defaultValue={typeof value === 'string' ? value : ''} />
      ) : f.kind === 'date' ? (
        <input {...common} type="date" defaultValue={dateValue(value)} />
      ) : f.kind === 'int' ? (
        <input {...common} type="number" step={1} defaultValue={typeof value === 'number' ? value : ''} />
      ) : (
        <input {...common} type="text" defaultValue={typeof value === 'string' ? value : ''} />
      )}
      {hint}
    </div>
  );
}

/** Универсальная форма раздела: поля — из ENTITY_FIELDS; отправка multipart на /admin/content/save/<раздел>. */
export function EntityForm({
  entity,
  id,
  record,
  previews = {},
  submitLabel = 'Сохранить',
}: {
  entity: EntityKey;
  id?: number;
  record?: Record<string, unknown>;
  previews?: Record<string, { src: string; alt: string } | null>;
  submitLabel?: string;
}) {
  const values = record ?? NEW_DEFAULTS[entity] ?? {};
  const prefix = `f-${entity}-${id ?? 'new'}`;
  return (
    <form method="post" action={`/admin/content/save/${entity}`} encType="multipart/form-data" className="adm-form adm-card">
      {id !== undefined ? <input type="hidden" name="id" value={id} /> : null}
      {ENTITY_FIELDS[entity].map((f) => (
        <Field key={f.name} f={f} id={`${prefix}-${f.name}`} record={values} preview={previews[f.name]} />
      ))}
      <div className="adm-actions">
        <button type="submit" className="button">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function DeleteForm({ entity, id, label = 'Удалить' }: { entity: EntityKey; id: number; label?: string }) {
  return (
    <form method="post" action={`/admin/content/save/${entity}`}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="_action" value="delete" />
      <button type="submit" className="button button--outline">
        {label}
      </button>
    </form>
  );
}
