import type { Metadata } from 'next';
import { FormField } from '@/ui/admin/kit/FormField';
import { ROLE_LABELS } from '@/ui/admin/kit/labels';
import { PageHeader } from '@/ui/admin/kit/PageHeader';
import { SaveBar } from '@/ui/admin/kit/SaveBar';
import { FlashToast } from '@/ui/admin/kit/Toaster';
import { UnsavedChangesGuard } from '@/ui/admin/kit/UnsavedChangesGuard';
import { requireStaffPage } from '@/ui/admin/guard';
import { fmtTime, str } from '../_lib/ui';
import { changePasswordAction, updateProfileAction } from './actions';
import { profileOps } from './profile-ops';

export const metadata: Metadata = { title: 'Профиль' };
export const dynamic = 'force-dynamic';

/** Профиль сотрудника: имя и смена своего пароля. Доступен любому авторизованному сотруднику. */
export default async function AdminProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage(null);
  const sp = await searchParams;
  const profile = profileOps.get(session);
  const passwordChanged = str(sp.saved) === 'password';

  return (
    <>
      <PageHeader title="Профиль" description="Ваше имя и пароль для входа в админку" />
      <FlashToast ok={str(sp.ok)} error={str(sp.error)} okText={passwordChanged ? 'Пароль изменён. Остальные сессии завершены.' : 'Сохранено.'} />

      <div className="ak-grid-2">
        <form id="profile-form" action={updateProfileAction} className="ak-card" aria-labelledby="profile-h">
          <h2 id="profile-h">Основное</h2>
          <div className="ak-form-grid">
            <FormField name="login" label="Логин" value={profile.email} readOnly hint="Логин меняет администратор в разделе «Пользователи»." />
            <FormField name="role" label="Роль" value={ROLE_LABELS[profile.role] ?? profile.role} readOnly />
            <FormField name="name" label="Имя" defaultValue={profile.name ?? ''} maxLength={100} autoComplete="name" hint="Показывается в верхней панели и в журнале." />
          </div>
          <p className="ak-field__hint">Последний вход: {fmtTime(profile.lastLoginAt)}</p>
          <SaveBar sticky={false} cancelHref="/admin" />
        </form>
        <UnsavedChangesGuard formId="profile-form" />

        <form id="password-form" action={changePasswordAction} className="ak-card" aria-labelledby="password-h">
          <h2 id="password-h">Смена пароля</h2>
          <div className="ak-form-grid">
            <FormField name="current" label="Текущий пароль" type="password" autoComplete="current-password" required />
            <FormField name="next" label="Новый пароль" type="password" autoComplete="new-password" required minLength={10} maxLength={200} hint="Не короче 10 символов." />
            <FormField name="confirm" label="Повторите новый пароль" type="password" autoComplete="new-password" required minLength={10} maxLength={200} />
          </div>
          <p className="ak-field__hint">После смены пароля вы останетесь в этой сессии, а на всех остальных устройствах вход нужно будет повторить.</p>
          <SaveBar sticky={false} saveLabel="Сменить пароль" />
        </form>
        <UnsavedChangesGuard formId="password-form" />
      </div>
    </>
  );
}
