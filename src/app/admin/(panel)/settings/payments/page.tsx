import type { Metadata } from 'next';
import { integrationsAdmin } from '@/domain/admin/integrations';
import { paymentAdmin } from '@/domain/ordering/payment-methods';
import type { PaymentMethodRow } from '@/server/db/repositories/methods';
import { requireStaffPage } from '@/ui/admin/guard';
import { ConfirmButton, PageHeader } from '@/ui/admin/kit';
import { Flash, fmtTime, str } from '../../_lib/ui';
import { bpInput, rubInput } from '../_forms';
import { SettingsTabs } from '../SettingsTabs';
import { checkPaymentAction, deletePaymentAction, savePaymentAction } from './actions';

export const metadata: Metadata = { title: 'Способы оплаты' };
export const dynamic = 'force-dynamic';

const STATE_TEXT = { not_configured: 'не настроено', configured_unverified: 'настроено, не проверено', connected: 'подключено', error: 'ошибка' } as const;

function MethodForm({ m }: { m: PaymentMethodRow | null }) {
  const k = m?.id ?? 'new';
  const online = m?.kind === 'online';
  return (
    <form action={savePaymentAction} aria-label={m ? `Способ «${m.name}»` : 'Новый способ оплаты'}>
      {m ? <input type="hidden" name="id" value={m.id} /> : null}
      <div className="adm-field">
        <label htmlFor={`p-name-${k}`}>Название</label>
        <input id={`p-name-${k}`} name="name" defaultValue={m?.name ?? ''} maxLength={120} required />
      </div>
      <div className="adm-field">
        <label htmlFor={`p-desc-${k}`}>Описание</label>
        <textarea id={`p-desc-${k}`} name="description" className="ops-textarea" defaultValue={m?.description ?? ''} maxLength={500} />
      </div>
      <div className="adm-field">
        <label htmlFor={`p-pct-${k}`}>Комиссия, %</label>
        <input id={`p-pct-${k}`} name="feePercent" inputMode="decimal" defaultValue={bpInput(m?.feePercentBp ?? 0)} />
        <span className="ops-muted">Процент от суммы к оплате (товары − скидка + известная доставка). Округление — в разделе «Налоги и цены».</span>
      </div>
      <div className="adm-field">
        <label htmlFor={`p-fix-${k}`}>Фиксированная комиссия, ₽</label>
        <input id={`p-fix-${k}`} name="feeFixed" inputMode="decimal" defaultValue={rubInput(m?.feeFixedKopecks ?? 0)} />
        <span className="ops-muted">Итог комиссии = фиксированная часть + процент. Включается в сумму заказа на сервере.</span>
      </div>
      <div className="adm-field">
        <label htmlFor={`p-min-${k}`}>Минимальная сумма заказа, ₽</label>
        <input id={`p-min-${k}`} name="min" inputMode="decimal" defaultValue={rubInput(m?.minKopecks)} placeholder="без ограничения" />
      </div>
      <div className="adm-field">
        <label htmlFor={`p-max-${k}`}>Максимальная сумма заказа, ₽</label>
        <input id={`p-max-${k}`} name="max" inputMode="decimal" defaultValue={rubInput(m?.maxKopecks)} placeholder="без ограничения" />
      </div>
      {online && !m?.testOnly ? (
        <div className="adm-field">
          <label htmlFor={`p-mode-${k}`}>Режим провайдера</label>
          <select id={`p-mode-${k}`} name="mode" defaultValue={m?.mode ?? 'live'}>
            <option value="live">Рабочий</option>
            <option value="test">Тестовый (в production запрещён)</option>
          </select>
        </div>
      ) : null}
      <div className="adm-field">
        <label htmlFor={`p-sort-${k}`}>Порядок</label>
        <input id={`p-sort-${k}`} name="sort" inputMode="numeric" defaultValue={m?.sort ?? 100} />
      </div>
      <label>
        <input type="checkbox" name="enabled" defaultChecked={m?.enabled ?? true} /> Способ доступен покупателям
      </label>
      <div className="adm-inline">
        <button type="submit" className="button">
          {m ? 'Сохранить' : 'Добавить способ'}
        </button>
        {m && m.kind !== 'online' ? (
          <ConfirmButton formAction={deletePaymentAction} title="Удалить способ оплаты?" description="Способ, по которому уже были заказы, удалить нельзя — его можно выключить." confirmLabel="Удалить" className="button button--outline">
            Удалить
          </ConfirmButton>
        ) : null}
      </div>
    </form>
  );
}

export default async function PaymentsSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('payments.write');
  const sp = await searchParams;
  const { methods, provider } = paymentAdmin.view(session);
  let state: (typeof STATE_TEXT)[keyof typeof STATE_TEXT] = 'не настроено';
  let checkedAt: number | null = null;
  let message: string | null = null;
  try {
    const card = integrationsAdmin.cards(session).find((c) => c.key === 'payment');
    if (card) {
      state = STATE_TEXT[card.state];
      checkedAt = card.checkedAt;
      message = card.message;
    }
  } catch {
    /* нет права на просмотр интеграций — статус не показываем */
  }
  return (
    <>
      <PageHeader title="Настройки магазина" description="Способы оплаты" />
      <SettingsTabs current="payments" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />

      <section className="adm-card" aria-labelledby="prov-h">
        <h2 id="prov-h">Платёжный провайдер</h2>
        <p>
          Выбранный провайдер: <strong>{provider.provider ?? 'не выбран'}</strong>. Состояние: <span className="ops-badge ops-badge--warn">{state}</span>
          {checkedAt ? ` (проверено ${fmtTime(checkedAt)})` : ''}
        </p>
        <p className="ops-muted">{message ?? provider.port.note}</p>
        <p className="ops-muted">
          Настоящих платёжных провайдеров в этой сборке нет: тестовая оплата деньги не списывает и боевой не считается. Онлайн-метод без подключённого провайдера включить нельзя.
        </p>
        <h3>Ключи и секреты</h3>
        <p className="ops-muted">
          Ключи не вводятся в админке и не хранятся в базе: они задаются только в окружении сервера (файл .env или настройки хостинга) и сюда не передаются. Показан лишь признак «задан / не задан».
        </p>
        <ul>
          {provider.secrets.map((s) => (
            <li key={s.name}>
              <code>{s.name}</code> — {s.purpose}: <span className={`ops-badge ${s.set ? 'ops-badge--ok' : ''}`}>{s.set ? 'задан' : 'не задан'}</span>
            </li>
          ))}
        </ul>
        <form action={checkPaymentAction}>
          <button type="submit" className="button button--outline">
            Проверить
          </button>
        </form>
      </section>

      <h2>Способы оплаты</h2>
      {methods.map((m) => (
        <details key={m.id} className="adm-card">
          <summary>
            {m.name} — {m.enabled ? 'доступен' : 'выключен'}
            {m.testOnly ? ' (тестовый)' : ''}
          </summary>
          <MethodForm m={m} />
        </details>
      ))}
      <h2>Новый способ «при получении»</h2>
      <div className="adm-card">
        <MethodForm m={null} />
      </div>
    </>
  );
}
