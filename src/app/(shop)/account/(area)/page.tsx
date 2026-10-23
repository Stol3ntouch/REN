import type { Metadata } from 'next';
import { accountConsents } from '@/domain/customers/account';
import { addresses } from '@/domain/customers/addresses';
import { profile } from '@/domain/customers/profile';
import { EmptyState } from '@/ui/states';
import { AccountForm } from './AccountForm';
import { addAddressAction, removeAddressAction, saveProfileAction } from './actions';
import { requireAccountPage } from './guard';

export const metadata: Metadata = { title: 'Личный кабинет', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  privacy: 'Обработка персональных данных',
  marketing: 'Рассылки и новости',
  terms: 'Условия продажи',
};
const SOURCE_LABELS: Record<string, string> = {
  register: 'Регистрация',
  checkout: 'Оформление заказа',
  callback: 'Заказ звонка',
  repair: 'Заявка на ремонт',
  question: 'Вопрос о товаре',
  contact: 'Обратная связь',
  review: 'Отзыв',
};

const fmtDate = (ms: number) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(ms));

export default async function AccountPage() {
  const session = await requireAccountPage('/account');
  const me = profile.get(session.userId);
  const list = addresses.list(session.userId);
  const consents = accountConsents.list(session.userId);

  return (
    <>
      <section className="account-section" aria-labelledby="acc-profile">
        <h2 id="acc-profile">Профиль</h2>
        <p>
          Email: <strong>{me.email}</strong>
        </p>
        <AccountForm
          idPrefix="profile"
          action={saveProfileAction}
          submitLabel="Сохранить"
          fields={[
            { name: 'name', label: 'Имя', type: 'text', defaultValue: me.name ?? '', autoComplete: 'name', maxLength: 100 },
            { name: 'phone', label: 'Телефон', type: 'tel', defaultValue: me.phone ?? '', autoComplete: 'tel', maxLength: 30, hint: 'Например, +7 900 000-00-00' },
          ]}
        />
      </section>

      <section className="account-section" aria-labelledby="acc-addresses">
        <h2 id="acc-addresses">Адреса</h2>
        {list.length === 0 ? (
          <EmptyState title="Сохранённых адресов нет">
            <p>Добавьте адрес — он понадобится при оформлении доставки.</p>
          </EmptyState>
        ) : (
          <ul className="account-list" aria-label="Мои адреса">
            {list.map((a) => (
              <li key={a.id}>
                <span>
                  {a.label ? <span className="account-list__label">{a.label}</span> : null}
                  {a.address}
                </span>
                <form action={removeAddressAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="link-button" aria-label={`Удалить адрес: ${a.label ?? a.address}`}>
                    Удалить
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <h3>Новый адрес</h3>
        <AccountForm
          idPrefix="address"
          action={addAddressAction}
          submitLabel="Добавить адрес"
          resetOnSuccess
          fields={[
            { name: 'label', label: 'Подпись (необязательно)', type: 'text', maxLength: 60, hint: 'Например, «Дача»' },
            { name: 'address', label: 'Адрес', type: 'textarea', maxLength: 300, required: true, autoComplete: 'street-address' },
          ]}
        />
      </section>

      <section className="account-section" aria-labelledby="acc-consents">
        <h2 id="acc-consents">Мои согласия</h2>
        {consents.length === 0 ? (
          <EmptyState title="Записей о согласиях пока нет" />
        ) : (
          <div className="table-scroll">
            <table className="account-table">
              <caption className="visually-hidden">Согласия, которые вы давали</caption>
              <thead>
                <tr>
                  <th scope="col">Согласие</th>
                  <th scope="col">Где дано</th>
                  <th scope="col">Когда</th>
                </tr>
              </thead>
              <tbody>
                {consents.map((c) => (
                  <tr key={c.id}>
                    <td>{KIND_LABELS[c.kind] ?? c.kind}</td>
                    <td>{SOURCE_LABELS[c.source] ?? c.source}</td>
                    <td>{fmtDate(c.grantedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
