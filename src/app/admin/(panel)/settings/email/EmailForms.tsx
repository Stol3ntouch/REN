'use client';

import { useActionState } from 'react';
import { previewTemplateAction, resetTemplateAction, saveTemplateAction, sendTestAction, toggleEventAction } from './actions';
import { MAIL_IDLE, type MailFormState } from './state';

function Result({ state }: { state: MailFormState }) {
  if (state.status === 'ok')
    return (
      <p className="adm-flash" role="status">
        {state.message}
      </p>
    );
  if (state.status === 'error')
    return (
      <p className="adm-flash adm-flash--error" role="alert">
        {state.message}
      </p>
    );
  if (state.status === 'preview')
    return (
      <div className="adm-card" role="status" aria-label="Предпросмотр на тестовых данных">
        <p className="ops-muted">Предпросмотр на тестовых данных (вымышленный клиент и заказ):</p>
        {state.problems.length > 0 ? (
          <ul className="ops-errors">
            {state.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <p>
          <strong>Тема:</strong> {state.subject || '—'}
        </p>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{state.body}</pre>
      </div>
    );
  return null;
}

type Aud = { audience: string; label: string; enabled: boolean; locked: boolean; custom: boolean; subject: string; body: string; defaultSubject: string; defaultBody: string; vars: { key: string; label: string; optional: boolean; link: boolean }[] };

/** Шаблон письма одного события для одного получателя: включение, тема, текст, предпросмотр, тестовая отправка, сброс. */
export function TemplateEditor({ event, audience }: { event: string; audience: Aud }) {
  const [preview, previewAction, previewPending] = useActionState(previewTemplateAction, MAIL_IDLE);
  const [test, testAction, testPending] = useActionState(sendTestAction, MAIL_IDLE);
  const id = `${event}-${audience.audience}`.replace(/[^a-z0-9-]/gi, '_');
  return (
    <div className="adm-card">
      <h4>
        {audience.label} {audience.custom ? <span className="ops-badge">свой шаблон</span> : <span className="ops-badge ops-badge--ok">по умолчанию</span>}
      </h4>
      <form action={toggleEventAction}>
        <input type="hidden" name="event" value={event} />
        <input type="hidden" name="audience" value={audience.audience} />
        <input type="hidden" name="enabled" value={audience.enabled ? '0' : '1'} />
        <span className={`ops-badge ${audience.enabled ? 'ops-badge--ok' : 'ops-badge--warn'}`}>{audience.enabled ? 'отправляется' : 'выключено'}</span>{' '}
        {audience.locked ? (
          <span className="ops-muted">отключить нельзя</span>
        ) : (
          <button type="submit" className="button button--outline button--small">
            {audience.enabled ? 'Выключить' : 'Включить'}
          </button>
        )}
      </form>
      <form action={saveTemplateAction}>
        <input type="hidden" name="event" value={event} />
        <input type="hidden" name="audience" value={audience.audience} />
        <div className="adm-field">
          <label htmlFor={`s-${id}`}>Тема</label>
          <input id={`s-${id}`} name="subject" defaultValue={audience.subject} maxLength={200} required />
        </div>
        <div className="adm-field">
          <label htmlFor={`b-${id}`}>Текст письма</label>
          <textarea id={`b-${id}`} name="body" className="ops-textarea" rows={10} defaultValue={audience.body} maxLength={5000} required />
        </div>
        <p className="ops-muted">
          Переменные: {audience.vars.map((v) => `{${v.key}}`).join(', ')}. Строка с пустой необязательной переменной в письмо не попадает. Ссылки с токеном в тему вставлять нельзя.
        </p>
        <div className="adm-inline">
          <button type="submit" className="button">
            Сохранить шаблон
          </button>
          <button type="submit" formAction={previewAction} className="button button--outline" disabled={previewPending}>
            Предпросмотр
          </button>
          <button type="submit" formAction={resetTemplateAction} className="button button--outline" formNoValidate>
            Вернуть по умолчанию
          </button>
        </div>
      </form>
      <Result state={preview} />
      <form action={testAction}>
        <input type="hidden" name="event" value={event} />
        <input type="hidden" name="audience" value={audience.audience} />
        <div className="adm-field">
          <label htmlFor={`t-${id}`}>Отправить пробное письмо с этим шаблоном на адрес</label>
          <input id={`t-${id}`} name="to" type="email" autoComplete="off" required />
        </div>
        <button type="submit" className="button button--outline" disabled={testPending}>
          Тестовая отправка
        </button>
      </form>
      <Result state={test} />
    </div>
  );
}

/** Тестовая отправка без шаблона: проверка самой связи с SMTP. */
export function SmtpTestForm() {
  const [state, action, pending] = useActionState(sendTestAction, MAIL_IDLE);
  return (
    <>
      <form action={action}>
        <div className="adm-field">
          <label htmlFor="smtp-test-to">Отправить тестовое письмо на адрес</label>
          <input id="smtp-test-to" name="to" type="email" autoComplete="off" required />
        </div>
        <button type="submit" className="button" disabled={pending}>
          Тестовая отправка
        </button>
      </form>
      <Result state={state} />
    </>
  );
}
