'use client';

import { useActionState, useEffect, useRef } from 'react';
import { ErrorState, SuccessState } from '@/ui/states';
import { IDLE, type FormState } from '../(auth)/form-state';

export type AccountField = {
  name: string;
  label: string;
  type: 'text' | 'tel' | 'textarea';
  defaultValue?: string;
  autoComplete?: string;
  hint?: string;
  maxLength?: number;
  required?: boolean;
};

/** Форма кабинета: работает и без JS (server action), с JS показывает ошибки по полям и результат. */
export function AccountForm({
  action,
  fields,
  submitLabel,
  idPrefix,
  resetOnSuccess = false,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  fields: AccountField[];
  submitLabel: string;
  idPrefix: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.status === 'success') ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className="account-form" noValidate>
      {state.status === 'error' && state.message ? (
        <ErrorState title="Не получилось">
          <p>{state.message}</p>
        </ErrorState>
      ) : null}
      {state.status === 'success' && state.message ? (
        <SuccessState title="Готово">
          <p>{state.message}</p>
        </SuccessState>
      ) : null}

      {fields.map((f) => {
        const errors = state.fields?.[f.name];
        const id = `${idPrefix}-${f.name}`;
        const describedBy = [f.hint ? `${id}-hint` : '', errors ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
        return (
          <div className="account-field" key={f.name}>
            <label htmlFor={id}>{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea
                id={id}
                name={f.name}
                rows={3}
                defaultValue={f.defaultValue}
                maxLength={f.maxLength}
                required={f.required}
                autoComplete={f.autoComplete}
                aria-invalid={errors ? true : undefined}
                aria-describedby={describedBy}
              />
            ) : (
              <input
                id={id}
                name={f.name}
                type={f.type}
                defaultValue={f.defaultValue}
                maxLength={f.maxLength}
                required={f.required}
                autoComplete={f.autoComplete}
                aria-invalid={errors ? true : undefined}
                aria-describedby={describedBy}
              />
            )}
            {f.hint ? (
              <p className="account-field__hint" id={`${id}-hint`}>
                {f.hint}
              </p>
            ) : null}
            {errors ? (
              <p className="account-field__error" id={`${id}-error`}>
                {errors[0]}
              </p>
            ) : null}
          </div>
        );
      })}

      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        {pending ? 'Сохраняем…' : submitLabel}
      </button>
    </form>
  );
}
