import type { Metadata } from 'next';
import Link from 'next/link';
import { resetAction } from '../../actions';
import { AuthForm } from '../../AuthForm';

// Токен в адресе: не отдаём его в Referer и не индексируем страницу.
export const metadata: Metadata = { title: 'Новый пароль', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <section className="auth-card" aria-labelledby="reset-title">
      <h1 id="reset-title">Новый пароль</h1>
      <AuthForm
        action={resetAction}
        submitLabel="Сохранить пароль"
        hidden={{ token }}
        fields={[{ name: 'password', label: 'Новый пароль', type: 'password', autoComplete: 'new-password', hint: 'Не короче 10 символов', minLength: 10 }]}
      />
      <div className="auth-links">
        <Link href="/account/forgot">Запросить новую ссылку</Link>
      </div>
    </section>
  );
}
