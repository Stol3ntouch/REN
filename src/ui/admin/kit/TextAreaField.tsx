import type { TextareaHTMLAttributes } from 'react';
import { FieldShell, describedBy, errorText, type FieldCommon } from './field-shell';

/** Многострочное поле. */
export function TextAreaField({ name, label, hint, error, id, className, required, rows = 4, ...rest }: FieldCommon & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'name' | 'id'>) {
  const fid = id ?? `f-${name}`;
  const message = errorText(error);
  return (
    <FieldShell id={fid} label={label} hint={hint} error={message} required={required} {...(className ? { className } : {})}>
      <textarea id={fid} name={name} rows={rows} required={required} aria-invalid={message ? true : undefined} aria-describedby={describedBy(fid, { hint, error: message })} {...rest} />
    </FieldShell>
  );
}
