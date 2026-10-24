import type { Metadata } from 'next';
import Link from 'next/link';
import { peekStaffLink } from '@/domain/admin/staff-reset';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata: Metadata = { title: 'Новый пароль', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

export default async function AdminResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = peekStaffLink(token);
  return (
    <main className="admin-login" id="admin-main">
      <h1>{link?.kind === 'invite' ? 'Установка пароля' : 'Новый пароль'}</h1>
      {link ? (
        <SetPasswordForm token={token} />
      ) : (
        <p role="alert">
          Ссылка недействительна или устарела. Попросите администратора выдать новую или запросите её на странице <Link href="/admin/forgot-password">восстановления пароля</Link>.
        </p>
      )}
    </main>
  );
}
