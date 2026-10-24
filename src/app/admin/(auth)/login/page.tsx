import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaffSession } from '@/domain/admin/staff-session';
import { AdminLoginForm } from '@/ui/admin/AdminLoginForm';
import { adminLoginAction } from '../actions';

export const metadata: Metadata = { title: 'Вход' };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  if (getStaffSession(await cookies())) redirect('/admin');
  return (
    <main className="admin-login" id="admin-main">
      <h1>Вход в админку</h1>
      {sp.reset === '1' ? <p role="status">Пароль установлен. Войдите с новым паролем.</p> : null}
      <AdminLoginForm action={adminLoginAction} />
      <p>
        <Link href="/admin/forgot-password">Забыли пароль?</Link>
      </p>
    </main>
  );
}
