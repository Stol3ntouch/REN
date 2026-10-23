import type { Metadata } from 'next';
import { requireStaffPage } from '@/ui/admin/guard';
import { staffOps } from '../_lib/staff-ops';
import { ACCESS_NAV, Flash, fmtTime, str, SubNav } from '../_lib/ui';
import { createStaffAction, setActiveAction, setRoleAction } from './actions';

export const metadata: Metadata = { title: 'Сотрудники' };
export const dynamic = 'force-dynamic';

const ROLE_LABELS = { admin: 'администратор', manager: 'менеджер' } as const;

export default async function AdminStaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('staff.manage');
  const sp = await searchParams;
  const staff = staffOps.list(session);

  return (
    <>
      <h1>Сотрудники</h1>
      <SubNav items={ACCESS_NAV} current="/admin/staff" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      <div className="adm-table-wrap">
        <table className="adm-table">
          <caption className="visually-hidden">Сотрудники и роли</caption>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Имя</th>
              <th scope="col">Роль</th>
              <th scope="col">Статус</th>
              <th scope="col">Последний вход</th>
              <th scope="col">Действия</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.email}</td>
                <td>{s.name ?? '—'}</td>
                <td>{ROLE_LABELS[s.role]}</td>
                <td>
                  <span className={`ops-badge ${s.active ? 'ops-badge--ok' : 'ops-badge--error'}`}>{s.active ? 'активен' : 'заблокирован'}</span>
                </td>
                <td>{fmtTime(s.lastLoginAt)}</td>
                <td>
                  <div className="adm-inline">
                    <form action={setRoleAction} className="adm-inline">
                      <input type="hidden" name="id" value={s.id} />
                      <label className="visually-hidden" htmlFor={`role-${s.id}`}>
                        Роль для {s.email}
                      </label>
                      <select id={`role-${s.id}`} name="role" defaultValue={s.role}>
                        <option value="admin">администратор</option>
                        <option value="manager">менеджер</option>
                      </select>
                      <button type="submit" className="button button--outline">
                        Сменить роль
                      </button>
                    </form>
                    <form action={setActiveAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="active" value={s.active ? '0' : '1'} />
                      <button type="submit" className="button button--outline" aria-label={`${s.active ? 'Заблокировать' : 'Разблокировать'} ${s.email}`}>
                        {s.active ? 'Заблокировать' : 'Разблокировать'}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ops-muted">Последнего администратора нельзя понизить или заблокировать; себя заблокировать нельзя. Блокировка сразу закрывает сессии.</p>

      <form action={createStaffAction} className="adm-card" aria-label="Новый сотрудник">
        <h2>Новый сотрудник</h2>
        <div className="adm-filters">
          <div className="adm-field">
            <label htmlFor="st-email">Email</label>
            <input id="st-email" name="email" type="email" required maxLength={254} autoComplete="off" />
          </div>
          <div className="adm-field">
            <label htmlFor="st-name">Имя</label>
            <input id="st-name" name="name" maxLength={100} autoComplete="off" />
          </div>
          <div className="adm-field">
            <label htmlFor="st-pass">Пароль (не короче 10 символов)</label>
            <input id="st-pass" name="password" type="password" required minLength={10} autoComplete="new-password" />
          </div>
          <div className="adm-field">
            <label htmlFor="st-role">Роль</label>
            <select id="st-role" name="role" defaultValue="manager">
              <option value="manager">менеджер</option>
              <option value="admin">администратор</option>
            </select>
          </div>
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Создать
          </button>
        </div>
      </form>
    </>
  );
}
