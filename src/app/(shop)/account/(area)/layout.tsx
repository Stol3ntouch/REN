import type { ReactNode } from 'react';
import { AccountNav } from './AccountNav';
import './account.css';

/** Каркас кабинета (внутри (shop): шапка и подвал есть). Доступ закрыт в каждой странице через requireAccountPage. */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="account container">
      <h1 className="account__title">Личный кабинет</h1>
      <AccountNav />
      {children}
    </div>
  );
}
