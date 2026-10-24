import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConfirmButton, FormField, PageHeader, SaveBar, SelectField, StatusBadge, UnsavedChangesGuard } from '@/ui/admin/kit';
import { FlashToast } from '@/ui/admin/kit/Toaster';
import { requireStaffPage } from '@/ui/admin/guard';
import { NotFoundError } from '@/server/http/errors';
import { staffOps } from '../../_lib/staff-ops';
import { fmtTime, str } from '../../_lib/ui';
import { setActiveAction, updateStaffAction } from '../actions';
import { ResetLinkForm } from '../StaffForms';

export const metadata: Metadata = { title: 'Пользователь' };
export const dynamic = 'force-dynamic';

export default async function AdminStaffEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireStaffPage('users.manage');
  const { id: rawId } = await params;
  const sp = await searchParams;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) notFound();
  let view;
  try {
    view = staffOps.get(session, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { staff, openSessions, manageable } = view;
  const assignable = staffOps.assignableRoles(session);
  const roleOptions = assignable.some((r) => r.id === staff.roleId) ? assignable : [{ id: staff.roleId, code: staff.role, name: staff.roleName }, ...assignable];

  return (
    <>
      <PageHeader
        title={staff.name || staff.email}
        description={
          <>
            {staff.email} · <StatusBadge tone={staff.active ? 'success' : 'danger'}>{staff.active ? 'Активен' : 'Заблокирован'}</StatusBadge>
          </>
        }
      />
      <FlashToast ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      {!manageable ? <p className="ak-field__hint">Права этого сотрудника шире ваших: просматривать можно, менять — нельзя.</p> : null}

      <div className="ak-grid-2">
        <form id="staff-edit-form" action={updateStaffAction} className="ak-card" aria-labelledby="staff-edit-h">
          <h2 id="staff-edit-h">Основное</h2>
          <input type="hidden" name="id" value={staff.id} />
          <div className="ak-form-grid">
            <FormField name="login" label="Логин" value={staff.email} readOnly hint="Логин не меняется." />
            <FormField name="name" label="Имя" defaultValue={staff.name ?? ''} maxLength={100} disabled={!manageable} />
            <SelectField name="role" label="Роль" defaultValue={staff.role} disabled={!manageable} options={roleOptions.map((r) => ({ value: r.code, label: r.name }))} />
          </div>
          <p className="ak-field__hint">
            Последний вход: {fmtTime(staff.lastLoginAt)} · Открытых сессий: {openSessions}
          </p>
          {manageable ? <SaveBar sticky={false} cancelHref="/admin/staff" /> : null}
        </form>
        <UnsavedChangesGuard formId="staff-edit-form" />

        {manageable ? (
          <div>
            {staff.active ? <ResetLinkForm staffId={staff.id} login={staff.email} /> : null}
            <form action={setActiveAction} className="ak-card" aria-labelledby="staff-access-h">
              <h2 id="staff-access-h">Доступ</h2>
              <input type="hidden" name="id" value={staff.id} />
              <input type="hidden" name="active" value={staff.active ? '0' : '1'} />
              <p className="ak-field__hint">
                {staff.active
                  ? 'Блокировка сразу завершает все сессии сотрудника: войти он больше не сможет.'
                  : 'Возврат доступа разрешает вход. Пароль не меняется — при необходимости выдайте ссылку для сброса.'}
              </p>
              {staff.active ? (
                <ConfirmButton title="Заблокировать пользователя?" description="Все его сессии будут завершены, вход станет невозможен." confirmLabel="Заблокировать">
                  Заблокировать
                </ConfirmButton>
              ) : (
                <button type="submit" className="ak-btn ak-btn--primary">
                  Вернуть доступ
                </button>
              )}
            </form>
          </div>
        ) : null}
      </div>
    </>
  );
}
