'use client';

import { useActionState } from 'react';
import { ErrorState, SuccessState } from '@/ui/states';
import './auth.css';
import { IDLE, type FormState } from './form-state';

export type AuthFieldDef = {
  name: string;
  label: string;
  type: 'email' | 'password';
  autoComplete: string;
  hint?: string;
  minLength?: number;
};

type Props = {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  fields: AuthFieldDef[];
  submitLabel: string;
  /** Чекбокс согласия на обработку персональных данных (обязателен для регистрации). */
  consent?: boolean;
  hidden?: Record<string, string>;
};

/** Общая SSR-форма входа/регистрации/сброса: работает и без JS (action), с JS показывает состояния loading/error/success. */
export function AuthForm({ action, fields, submitLabel, consent = false, hidden = {} }: Props) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const summaryId = 'auth-form-status';

  return (
    <form action={formAction} className="auth-form" noValidate aria-describedby={state.status !== 'idle' ? summaryId : undefined}>
      {state.status === 'error' && state.message ? (
        <div id={summaryId}>
          <ErrorState title="Не получилось">
            <p>{state.message}</p>
          </ErrorState>
        </div>
      ) : null}
      {state.status === 'success' && state.message ? (
        <div id={summaryId}>
          <SuccessState title="Готово">
            <p>{state.message}</p>
          </SuccessState>
        </div>
      ) : null}

      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      {fields.map((f) => {
        const errors = state.fields?.[f.name];
        const hintId = `${f.name}-hint`;
        const errId = `${f.name}-error`;
        return (
          <div className="auth-field" key={f.name}>
            <label htmlFor={`f-${f.name}`}>{f.label}</label>
            <input
              id={`f-${f.name}`}
              name={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              required
              minLength={f.minLength}
              aria-invalid={errors ? true : undefined}
              aria-describedby={[f.hint ? hintId : '', errors ? errId : ''].filter(Boolean).join(' ') || undefined}
            />
            {f.hint ? (
              <p className="auth-field__hint" id={hintId}>
                {f.hint}
              </p>
            ) : null}
            {errors ? (
              <p className="auth-field__error" id={errId}>
                {errors[0]}
              </p>
            ) : null}
          </div>
        );
      })}

      {consent ? (
        <div className="auth-field">
          <label className="auth-consent">
            <input
              type="checkbox"
              name="consent"
              required
              aria-invalid={state.fields?.consent ? true : undefined}
              aria-describedby={state.fields?.consent ? 'consent-error' : undefined}
            />
            <span>
              Я согласен на обработку персональных данных (<a href="/privacy">политика конфиденциальности</a>)
            </span>
          </label>
          {state.fields?.consent ? (
            <p className="auth-field__error" id="consent-error">
              {state.fields.consent[0]}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Honeypot: настоящие пользователи это поле не видят */}
      <div className="auth-trap" aria-hidden="true">
        <label>
          Сайт
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        {pending ? 'Подождите…' : submitLabel}
      </button>
    </form>
  );
}
