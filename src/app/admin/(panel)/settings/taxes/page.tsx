import type { Metadata } from 'next';
import Link from 'next/link';
import { getStoreFlags } from '@/domain/content/store-flags';
import { getStoreSettings } from '@/domain/content/store-settings';
import { taxesAdmin } from '@/domain/ordering/pricing-rules';
import type { TaxRateRow } from '@/server/db/repositories/taxes';
import { requireStaffPage } from '@/ui/admin/guard';
import { ConfirmButton, PageHeader } from '@/ui/admin/kit';
import { Flash, str } from '../../_lib/ui';
import { bpInput } from '../_forms';
import { SettingsTabs } from '../SettingsTabs';
import { deleteTaxRateAction, saveTaxRateAction, saveTaxSettingsAction, setDefaultTaxAction } from './actions';

export const metadata: Metadata = { title: 'Налоги и цены' };
export const dynamic = 'force-dynamic';

function RateForm({ r }: { r: TaxRateRow | null }) {
  const k = r?.id ?? 'new';
  return (
    <form action={saveTaxRateAction} aria-label={r ? `Ставка «${r.name}»` : 'Новая ставка'}>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <div className="adm-field">
        <label htmlFor={`t-name-${k}`}>Название</label>
        <input id={`t-name-${k}`} name="name" defaultValue={r?.name ?? ''} maxLength={80} required />
      </div>
      <div className="adm-field">
        <label htmlFor={`t-rate-${k}`}>Ставка, %</label>
        <input id={`t-rate-${k}`} name="rate" inputMode="decimal" defaultValue={r ? bpInput(r.rateBp) : ''} required />
        <span className="ops-muted">До двух знаков после запятой, например 20 или 7,5.</span>
      </div>
      <label>
        <input type="checkbox" name="includedInPrice" defaultChecked={r?.includedInPrice ?? true} /> Ставка уже включена в цену (налог выделяется из цены; если не отмечено — прибавляется сверху)
      </label>
      <label>
        <input type="checkbox" name="active" defaultChecked={r?.active ?? true} /> Действует
      </label>
      <div className="adm-field">
        <label htmlFor={`t-sort-${k}`}>Порядок</label>
        <input id={`t-sort-${k}`} name="sort" inputMode="numeric" defaultValue={r?.sort ?? 100} />
      </div>
      <div className="adm-inline">
        <button type="submit" className="button">
          {r ? 'Сохранить' : 'Добавить ставку'}
        </button>
      </div>
    </form>
  );
}

export default async function TaxesSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('settings.write');
  const sp = await searchParams;
  const { settings, rates } = taxesAdmin.view(session);
  const flags = getStoreFlags();
  let currency = '';
  try {
    currency = getStoreSettings(session).currency;
  } catch {
    currency = '';
  }
  return (
    <>
      <PageHeader title="Настройки магазина" description="Налоги, округление и цены" />
      <SettingsTabs current="taxes" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />

      <section className="adm-card" aria-labelledby="cur-h">
        <h2 id="cur-h">Валюта и видимость цен</h2>
        <p>
          Валюта магазина: <strong>{currency || '—'}</strong>. Деньги в системе хранятся в копейках, валюта меняет только символ при показе. Показ цен на сайте:{' '}
          <strong>{flags.showPrices ? 'включён' : 'выключен'}</strong>.
        </p>
        <p className="ops-muted">
          Валюта и переключатель «Показывать цены» меняются в <Link href="/admin/settings/store">основных настройках</Link>.
        </p>
      </section>

      <section className="adm-card" aria-labelledby="round-h">
        <h2 id="round-h">Округление</h2>
        <form action={saveTaxSettingsAction}>
          <div className="adm-field">
            <label htmlFor="tx-rule">Правило округления</label>
            <select id="tx-rule" name="rule" defaultValue={settings.rounding.rule}>
              <option value="nearest">До ближайшего (половина — вверх)</option>
              <option value="down">Вниз</option>
              <option value="up">Вверх</option>
              <option value="none">Без округления (до копейки, половина вверх)</option>
            </select>
          </div>
          <div className="adm-field">
            <label htmlFor="tx-step">Округлять до</label>
            <select id="tx-step" name="step" defaultValue={settings.rounding.step}>
              <option value="kopeck">копейки</option>
              <option value="ruble">рубля</option>
            </select>
            <span className="ops-muted">Правило применяется к процентам: комиссии оплаты и налогу. Цены товаров и суммы в копейках не меняются.</span>
          </div>
          <label>
            <input type="checkbox" name="pricesIncludeTax" defaultChecked={settings.pricesIncludeTax} /> Цены включают налог (любая ставка выделяется из цены, итог не растёт)
          </label>
          <div className="adm-inline">
            <button type="submit" className="button">
              Сохранить
            </button>
          </div>
        </form>
      </section>

      <h2>Налоговые ставки</h2>
      <p className="ops-muted">Ставок по умолчанию нет: пока ставка не назначена, налог в заказах не начисляется. Применяется ставка «по умолчанию», она записывается в заказ и его позиции.</p>
      {rates.length === 0 ? <p>Ставок пока нет.</p> : null}
      {rates.map((r) => (
        <details key={r.id} className="adm-card">
          <summary>
            {r.name} — {bpInput(r.rateBp)} % {r.isDefault ? '(по умолчанию)' : ''} {r.active ? '' : '(не действует)'}
          </summary>
          <RateForm r={r} />
          <div className="adm-inline">
            {!r.isDefault ? (
              <form action={setDefaultTaxAction}>
                <input type="hidden" name="id" value={r.id} />
                <button type="submit" className="button button--outline">
                  Применять по умолчанию
                </button>
              </form>
            ) : (
              <form action={setDefaultTaxAction}>
                <input type="hidden" name="id" value="" />
                <button type="submit" className="button button--outline">
                  Не начислять налог
                </button>
              </form>
            )}
            <form action={deleteTaxRateAction}>
              <input type="hidden" name="id" value={r.id} />
              <ConfirmButton title="Удалить ставку?" description="Прошлые заказы хранят снимок ставки и не изменятся." confirmLabel="Удалить" className="button button--outline">
                Удалить
              </ConfirmButton>
            </form>
          </div>
        </details>
      ))}
      <h2>Новая ставка</h2>
      <div className="adm-card">
        <RateForm r={null} />
      </div>
    </>
  );
}
