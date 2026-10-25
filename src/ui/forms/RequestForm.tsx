'use client';

import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { ErrorState, SuccessState } from '@/ui/states';
import './forms.css';

export type FieldDef = {
  name: string;
  label: string;
  type: 'text' | 'tel' | 'email' | 'textarea' | 'select' | 'rating';
  required?: boolean;
  autoComplete?: string;
  hint?: string;
  rows?: number;
  options?: { value: string; label: string }[];
  defaultValue?: string;
};

type Props = {
  /** repair | callback | contact | question | review → POST /api/forms/<kind> */
  kind: string;
  fields: FieldDef[];
  submitLabel: string;
  successTitle: string;
  successText: string;
  /** Скрытые служебные значения (например, productId). */
  hidden?: Record<string, string | number>;
  /** Поле «Фото» (до 5 файлов): после создания заявки файлы уходят на /api/forms/repair/photos. */
  photos?: boolean;
};

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type State = { status: 'idle' | 'sending' | 'error' | 'success'; message?: string; fields?: Record<string, string[]>; number?: string | null };

const MESSAGES: Record<number, string> = {
  403: 'Запрос отклонён. Обновите страницу и попробуйте ещё раз.',
  404: 'Не удалось найти форму или товар. Обновите страницу.',
  413: 'Слишком длинный текст. Сократите сообщение.',
  429: 'Слишком много обращений с вашего адреса. Попробуйте через час или позвоните нам.',
};

/**
 * Общая клиентская форма обращений: состояния sending / error / success, ошибки по полям,
 * honeypot «website», обязательное согласие на обработку персональных данных.
 */
export function RequestForm({ kind, fields, submitLabel, successTitle, successText, hidden = {}, photos = false }: Props) {
  const uid = useId();
  const [state, setState] = useState<State>({ status: 'idle' });
  const formRef = useRef<HTMLFormElement>(null);
  const id = (name: string) => `${uid}-${name}`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.status === 'sending') return;
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...hidden, website: String(form.get('website') ?? ''), consent: form.get('consent') === 'on' };
    for (const f of fields) body[f.name] = String(form.get(f.name) ?? '');
    const files = photos ? form.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0) : [];
    if (files.length > MAX_PHOTOS || files.some((f) => f.size > MAX_PHOTO_BYTES)) {
      setState({ status: 'error', message: `Приложите не больше ${MAX_PHOTOS} фото, каждое до 5 МБ (JPG, PNG или WebP).` });
      return;
    }

    setState({ status: 'sending' });
    try {
      const res = await fetch(`/api/forms/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { number?: string | null; photoToken?: string; error?: { message?: string; fields?: Record<string, string[]> } };
      if (res.ok) {
        let note: string | undefined;
        if (files.length > 0 && data.number && data.photoToken) {
          // заявка уже принята; фото — отдельным запросом, их сбой не отменяет заявку
          const upload = new FormData();
          upload.set('number', data.number);
          upload.set('token', data.photoToken);
          for (const f of files) upload.append('photo', f);
          const up = await fetch('/api/forms/repair/photos', { method: 'POST', body: upload }).catch(() => null);
          if (!up || !up.ok) note = 'Заявка принята, но фото загрузить не удалось. Назовите номер заявки менеджеру или пришлите фото ему.';
        }
        formRef.current?.reset();
        setState({ status: 'success', number: data.number ?? null, message: note });
        return;
      }
      setState({
        status: 'error',
        message: MESSAGES[res.status] ?? data.error?.message ?? 'Не удалось отправить. Попробуйте ещё раз.',
        fields: res.status === 400 ? data.error?.fields : undefined,
      });
    } catch {
      setState({ status: 'error', message: 'Не удалось отправить: нет связи с сервером. Проверьте интернет и повторите.' });
    }
  }

  if (state.status === 'success') {
    return (
      <SuccessState title={successTitle}>
        <p>{successText}</p>
        {state.number ? (
          <p>
            Номер обращения: <strong>{state.number}</strong>
          </p>
        ) : null}
        {state.message ? <p role="status">{state.message}</p> : null}
      </SuccessState>
    );
  }

  const errors = state.fields ?? {};
  return (
    <form ref={formRef} onSubmit={onSubmit} className="req-form" noValidate>
      {state.status === 'error' && state.message ? (
        <ErrorState title="Не получилось отправить">
          <p>{state.message}</p>
        </ErrorState>
      ) : null}

      {fields.map((f) => {
        const err = errors[f.name]?.[0];
        const describedBy = [f.hint ? `${id(f.name)}-hint` : '', err ? `${id(f.name)}-err` : ''].filter(Boolean).join(' ') || undefined;
        const common = {
          id: id(f.name),
          name: f.name,
          required: f.required,
          'aria-invalid': err ? true : undefined,
          'aria-describedby': describedBy,
        } as const;
        return (
          <div className="req-field" key={f.name}>
            {f.type === 'rating' ? (
              <fieldset className="req-rating" aria-describedby={describedBy}>
                <legend>{f.label}</legend>
                <div className="req-rating__options">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n}>
                      <input type="radio" name={f.name} value={n} required={f.required} defaultChecked={f.defaultValue === String(n)} />
                      <span>{n}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <>
                <label htmlFor={common.id}>
                  {f.label}
                  {f.required ? <span aria-hidden="true"> *</span> : null}
                </label>
                {f.type === 'textarea' ? (
                  <textarea {...common} rows={f.rows ?? 4} defaultValue={f.defaultValue} />
                ) : f.type === 'select' ? (
                  <select {...common} defaultValue={f.defaultValue}>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input {...common} type={f.type} autoComplete={f.autoComplete} defaultValue={f.defaultValue} />
                )}
              </>
            )}
            {f.hint ? (
              <p className="req-field__hint" id={`${id(f.name)}-hint`}>
                {f.hint}
              </p>
            ) : null}
            {err ? (
              <p className="req-field__error" id={`${id(f.name)}-err`}>
                {err}
              </p>
            ) : null}
          </div>
        );
      })}

      {photos ? (
        <div className="req-field">
          <label htmlFor={id('photo')}>Фото неисправности</label>
          <input id={id('photo')} name="photo" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby={`${id('photo')}-hint`} />
          <p className="req-field__hint" id={`${id('photo')}-hint`}>
            Необязательно. До {MAX_PHOTOS} фото JPG, PNG или WebP, каждое до 5 МБ.
          </p>
        </div>
      ) : null}

      {/* Honeypot: человек не видит и не заполняет; бот заполнит — заявка тихо отбрасывается на сервере. */}
      <div className="req-trap" aria-hidden="true">
        <label htmlFor={id('website')}>Не заполняйте это поле</label>
        <input id={id('website')} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="req-field">
        <label className="req-consent" htmlFor={id('consent')}>
          <input id={id('consent')} name="consent" type="checkbox" required aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? `${id('consent')}-err` : undefined} />
          <span>
            Согласен(на) на обработку персональных данных в соответствии с <Link href="/privacy">политикой конфиденциальности</Link>
          </span>
        </label>
        {errors.consent?.[0] ? (
          <p className="req-field__error" id={`${id('consent')}-err`}>
            {errors.consent[0]}
          </p>
        ) : null}
      </div>

      <button type="submit" className="button" disabled={state.status === 'sending'}>
        {state.status === 'sending' ? 'Отправляем…' : submitLabel}
      </button>
    </form>
  );
}
