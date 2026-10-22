import type { Metadata } from 'next';
import Link from 'next/link';
import { forgotAction } from '../actions';
import { AuthForm } from '../AuthForm';

export const metadata: Metadata = { title: 'Восстановление пароля', robots: { index: false, follow: false } };

export default function ForgotPage() {
  return (
    <section className="auth-card" aria-labelledby="forgot-title">
      <h1 id="forgot-title">Восстановление пароля</h1>
      <p>Укажите email аккаунта — мы отправим ссылку для создания нового пароля.</p>
      <AuthForm
        action={forgotAction}
        submitLabel="Отправить ссылку"
        fields={[{ name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }]}
      />
      <div className="auth-links">
        <Link href="/account/login">Вернуться ко входу</Link>
      </div>
    </section>
  );
}
