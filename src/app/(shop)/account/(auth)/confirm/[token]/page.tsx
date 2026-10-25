import type { Metadata } from 'next';
import Link from 'next/link';
import { confirmEmailAction } from '../../actions';
import { AuthForm } from '../../AuthForm';

// Токен в адресе: не отдаём его в Referer и не индексируем страницу.
export const metadata: Metadata = { title: 'Подтверждение email', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Подтверждение email. Ссылка из письма только открывает страницу; сам токен тратится по нажатию кнопки (POST):
 * иначе почтовые сканеры, открывающие ссылки заранее, «сжигали» бы её раньше человека.
 */
export default async function ConfirmEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <section className="auth-card" aria-labelledby="confirm-title">
      <h1 id="confirm-title">Подтверждение email</h1>
      <p>Нажмите кнопку, чтобы подтвердить адрес электронной почты.</p>
      <AuthForm action={confirmEmailAction} submitLabel="Подтвердить email" hidden={{ token }} fields={[]} />
      <div className="auth-links">
        <Link href="/account/login">Войти</Link>
      </div>
    </section>
  );
}
