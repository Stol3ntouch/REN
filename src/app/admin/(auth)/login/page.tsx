import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getStaffSession } from '@/domain/admin/staff-session';
import { AdminLoginForm } from '@/ui/admin/AdminLoginForm';
import { adminLoginAction } from '../actions';

export const metadata: Metadata = { title: 'Вход' };

export default async function AdminLoginPage() {
  if (getStaffSession(await cookies())) redirect('/admin');
  return (
    <main className="admin-login" id="admin-main">
      <h1>Вход в админку</h1>
      <AdminLoginForm action={adminLoginAction} />
    </main>
  );
}
