import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { safeRedirectPath } from '@/domain/customers/auth';
import { getSession } from '@/domain/customers/session';
import { SuccessState } from '@/ui/states';
import { loginAction } from '../actions';
import { AuthForm } from '../AuthForm';

export const metadata: Metadata = { title: 'Вход', robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const next = safeRedirectPath(sp.next);
  if (getSession(await cookies())) redirect(next);

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <h1 id="login-title">Вход</h1>
      {sp.reset ? (
        <SuccessState title="Пароль изменён">
          <p>Войдите с новым паролем.</p>
        </SuccessState>
      ) : null}
      <AuthForm
        action={loginAction}
        submitLabel="Войти"
        hidden={{ next }}
        fields={[
          { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
          { name: 'password', label: 'Пароль', type: 'password', autoComplete: 'current-password' },
        ]}
      />
      <div className="auth-links">
        <Link href="/account/forgot">Забыли пароль?</Link>
        <Link href="/account/register">Создать аккаунт</Link>
      </div>
    </section>
  );
}
