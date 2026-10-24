import type { SelectHTMLAttributes } from 'react';
import { FieldShell, describedBy, errorText, type FieldCommon } from './field-shell';

export type SelectOption = { value: string; label: string; disabled?: boolean };

/** Выпадающий список. `placeholder` — первый пустой пункт («Выберите…»). */
export function SelectField({
  name,
  label,
  hint,
  error,
  id,
  className,
  required,
  options,
  placeholder,
  ...rest
}: FieldCommon & { options: readonly SelectOption[]; placeholder?: string } & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'name' | 'id'>) {
  const fid = id ?? `f-${name}`;
  const message = errorText(error);
  return (
    <FieldShell id={fid} label={label} hint={hint} error={message} required={required} {...(className ? { className } : {})}>
      <select id={fid} name={name} required={required} aria-invalid={message ? true : undefined} aria-describedby={describedBy(fid, { hint, error: message })} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
