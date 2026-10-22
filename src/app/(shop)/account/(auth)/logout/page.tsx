import type { Metadata } from 'next';
import { logoutAction } from '../actions';
import '../auth.css';

export const metadata: Metadata = { title: 'Выход', robots: { index: false, follow: false } };

/** Выход — только POST (форма), чтобы чужая страница не могла разлогинить покупателя картинкой или ссылкой. */
export default function LogoutPage() {
  return (
    <section className="auth-card" aria-labelledby="logout-title">
      <h1 id="logout-title">Выход</h1>
      <p>Выйти из личного кабинета?</p>
      <form action={logoutAction}>
        <button type="submit" className="button">
          Выйти
        </button>
      </form>
    </section>
  );
}
