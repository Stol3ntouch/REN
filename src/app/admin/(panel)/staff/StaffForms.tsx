'use client';

import { useActionState } from 'react';
import { FormField } from '@/ui/admin/kit/FormField';
import { SelectField, type SelectOption } from '@/ui/admin/kit/SelectField';
import { SaveBar } from '@/ui/admin/kit/SaveBar';
import { UnsavedChangesGuard } from '@/ui/admin/kit/UnsavedChangesGuard';
import { createStaffAction, issueResetLinkAction } from './actions';
import { STAFF_IDLE, type StaffLinkInfo } from './state';

const fmt = (ms: number): string => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(ms));

/** Одноразовая ссылка: показывается один раз; закрыв страницу, получить её снова нельзя — только выдать новую. */
function LinkBox({ link, title }: { link: StaffLinkInfo; title: string }) {
  return (
    <div className="ak-card" role="status">
      <h2>{title}</h2>
      <p>
        Передайте ссылку сотруднику. Она действует до {fmt(link.expiresAt)} и работает один раз. Повторно показать её нельзя — только выдать новую.
        {link.mailed ? ' Копия отправлена на email сотрудника.' : ''}
      </p>
      <label className="ak-field__label" htmlFor="staff-link">
        Ссылка
      </label>
      <input id="staff-link" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} />
    </div>
  );
}

export function NewStaffForm({ roles }: { roles: readonly SelectOption[] }) {
  const [state, action, pending] = useActionState(createStaffAction, STAFF_IDLE);
  if (state.status === 'invite') return <LinkBox link={state.link} title={`Приглашение для ${state.login}`} />;
  const fields = state.status === 'error' ? (state.fields ?? {}) : {};
  return (
    <>
      <form id="staff-new-form" action={action} className="ak-card" aria-labelledby="staff-new-h" autoComplete="off">
        <h2 id="staff-new-h">Новый пользователь</h2>
        {state.status === 'error' ? (
          <p className="ak-field__error" role="alert">
            {state.message}
          </p>
        ) : null}
        <div className="ak-form-grid">
          <FormField name="email" label="Логин или email" required maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false} error={fields.email} hint="Email или короткий логин: латиница, цифры, . _ -" />
          <FormField name="name" label="Имя" maxLength={100} autoComplete="off" />
          <SelectField name="role" label="Роль" required options={roles} placeholder="Выберите роль" />
          <FormField
            name="password"
            label="Пароль"
            type="password"
            minLength={10}
            maxLength={200}
            autoComplete="new-password"
            hint="Не короче 10 символов. Оставьте пустым — тогда будет создана одноразовая ссылка-приглашение, по которой сотрудник задаст пароль сам."
          />
        </div>
        <SaveBar saveLabel="Создать" cancelHref="/admin/staff" pending={pending} sticky={false} />
      </form>
      <UnsavedChangesGuard formId="staff-new-form" />
    </>
  );
}

export function ResetLinkForm({ staffId, login }: { staffId: number; login: string }) {
  const [state, action, pending] = useActionState(issueResetLinkAction, STAFF_IDLE);
  return (
    <>
      <form action={action} className="ak-card" aria-labelledby="staff-reset-h">
        <h2 id="staff-reset-h">Сброс пароля</h2>
        <p className="ak-field__hint">
          Выдаёт одноразовую ссылку на 1 час; прежние ссылки сотрудника перестают работать. Пароль {login} не меняется, пока он сам не установит новый.
        </p>
        {state.status === 'error' ? (
          <p className="ak-field__error" role="alert">
            {state.message}
          </p>
        ) : null}
        <input type="hidden" name="id" value={staffId} />
        <button type="submit" className="ak-btn ak-btn--outline" disabled={pending} aria-busy={pending}>
          {pending ? 'Подождите…' : 'Выдать ссылку для сброса'}
        </button>
      </form>
      {state.status === 'reset' ? <LinkBox link={state.link} title="Ссылка для сброса пароля" /> : null}
    </>
  );
}
