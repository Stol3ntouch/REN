import type { InputHTMLAttributes } from 'react';
import { FieldShell, describedBy, errorText, type FieldCommon } from './field-shell';

/** Текстовое поле: подпись, подсказка, ошибка (aria-invalid + aria-describedby), обязательность. */
export function FormField({ name, label, hint, error, id, className, required, ...rest }: FieldCommon & Omit<InputHTMLAttributes<HTMLInputElement>, 'name' | 'id'>) {
  const fid = id ?? `f-${name}`;
  const message = errorText(error);
  return (
    <FieldShell id={fid} label={label} hint={hint} error={message} required={required} {...(className ? { className } : {})}>
      <input id={fid} name={name} required={required} aria-invalid={message ? true : undefined} aria-describedby={describedBy(fid, { hint, error: message })} {...rest} />
    </FieldShell>
  );
}
