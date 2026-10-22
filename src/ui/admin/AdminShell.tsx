import type { ReactNode } from 'react';
import type { StaffSession } from '@/domain/admin/permissions';
import { AdminNavLinks } from './AdminNavLinks';
import { visibleNav } from './nav';

const ROLE_LABEL = { admin: 'Администратор', manager: 'Менеджер' } as const;

/** Каркас админки: боковая навигация по разделам (скрыты по правам) и кнопка выхода. */
export function AdminShell({ session, logout, children }: { session: StaffSession; logout: () => Promise<void>; children: ReactNode }) {
  return (
    <div className="admin-shell">
      <a href="#admin-main" className="skip-link">
        Перейти к содержимому
      </a>
      <aside className="admin-aside">
        <p className="admin-brand">РемТехСад · Админка</p>
        <nav aria-label="Разделы админки">
          <AdminNavLinks items={visibleNav(session.role)} />
        </nav>
        <div className="admin-user">
          <p className="admin-user__name">{session.name ?? session.email}</p>
          <p className="admin-user__role">{ROLE_LABEL[session.role]}</p>
          <form action={logout}>
            <button type="submit" className="button button--outline">
              Выйти
            </button>
          </form>
        </div>
      </aside>
      <main id="admin-main" className="admin-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
