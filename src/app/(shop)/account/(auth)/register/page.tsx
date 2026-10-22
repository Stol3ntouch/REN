import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { safeRedirectPath } from '@/domain/customers/auth';
import { getSession } from '@/domain/customers/session';
import { registerAction } from '../actions';
import { AuthForm } from '../AuthForm';

export const metadata: Metadata = { title: 'Регистрация', robots: { index: false, follow: false } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeRedirectPath((await searchParams).next);
  if (getSession(await cookies())) redirect(next);

  return (
    <section className="auth-card" aria-labelledby="register-title">
      <h1 id="register-title">Регистрация</h1>
      <AuthForm
        action={registerAction}
        submitLabel="Зарегистрироваться"
        consent
        hidden={{ next }}
        fields={[
          { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
          { name: 'password', label: 'Пароль', type: 'password', autoComplete: 'new-password', hint: 'Не короче 10 символов', minLength: 10 },
        ]}
      />
      <div className="auth-links">
        <Link href="/account/login">Уже есть аккаунт? Войти</Link>
      </div>
    </section>
  );
}
