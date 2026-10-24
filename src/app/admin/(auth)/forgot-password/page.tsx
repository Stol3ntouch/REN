import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = { title: 'Восстановление пароля', referrer: 'no-referrer' };

export default function AdminForgotPasswordPage() {
  return (
    <main className="admin-login" id="admin-main">
      <h1>Восстановление пароля</h1>
      <ForgotPasswordForm />
      <p>
        <Link href="/admin/login">Вернуться ко входу</Link>
      </p>
    </main>
  );
}
