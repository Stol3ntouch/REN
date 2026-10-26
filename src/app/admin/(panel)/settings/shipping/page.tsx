import type { Metadata } from 'next';
import { deliveryAdmin } from '@/domain/ordering/delivery';
import { formatRub } from '@/domain/pricing/format';
import type { DeliveryMethodRow } from '@/server/db/repositories/methods';
import { requireStaffPage } from '@/ui/admin/guard';
import { ConfirmButton, EmptyState, PageHeader } from '@/ui/admin/kit';
import { Flash, str } from '../../_lib/ui';
import { rubInput } from '../_forms';
import { SettingsTabs } from '../SettingsTabs';
import { deleteDeliveryAction, saveDeliveryAction, toggleDeliveryAction } from './actions';

export const metadata: Metadata = { title: 'Доставка' };
export const dynamic = 'force-dynamic';

function MethodForm({ m }: { m: DeliveryMethodRow | null }) {
  const k = m?.id ?? 'new';
  return (
    <form action={saveDeliveryAction} aria-label={m ? `Способ «${m.name}»` : 'Новый способ получения'}>
      {m ? <input type="hidden" name="id" value={m.id} /> : null}
      <div className="adm-field">
        <label htmlFor={`d-name-${k}`}>Название</label>
        <input id={`d-name-${k}`} name="name" defaultValue={m?.name ?? ''} maxLength={120} required />
      </div>
      <div className="adm-field">
        <label htmlFor={`d-desc-${k}`}>Описание</label>
        <textarea id={`d-desc-${k}`} name="description" className="ops-textarea" defaultValue={m?.description ?? ''} maxLength={500} />
      </div>
      <div className="adm-field">
        <label htmlFor={`d-kind-${k}`}>Вид</label>
        <select id={`d-kind-${k}`} name="kind" defaultValue={m?.kind ?? 'manual'}>
          <option value="manual">Доставка</option>
          <option value="pickup">Самовывоз</option>
        </select>
      </div>
      <div className="adm-field">
        <label htmlFor={`d-price-${k}`}>Стоимость, ₽</label>
        <input id={`d-price-${k}`} name="price" inputMode="decimal" defaultValue={rubInput(m?.priceKopecks ?? 0)} />
        <label>
          <input type="checkbox" name="priceManual" defaultChecked={m ? m.priceKopecks === null : false} /> Стоимость рассчитает менеджер (число выше не используется)
        </label>
      </div>
      <div className="adm-field">
        <label htmlFor={`d-free-${k}`}>Бесплатно от суммы товаров, ₽</label>
        <input id={`d-free-${k}`} name="freeFrom" inputMode="decimal" defaultValue={rubInput(m?.freeFromKopecks)} placeholder="не ограничено" />
        <span className="ops-muted">Сумма после скидки. Пусто — порога нет.</span>
      </div>
      <div className="adm-field">
        <label htmlFor={`d-min-${k}`}>Минимальная сумма заказа, ₽</label>
        <input id={`d-min-${k}`} name="minOrder" inputMode="decimal" defaultValue={rubInput(m?.minOrderKopecks ?? 0)} />
        <span className="ops-muted">Ниже этой суммы способ недоступен. 0 — без ограничения.</span>
      </div>
      <div className="adm-field">
        <label htmlFor={`d-eta-${k}`}>Срок доставки (текст)</label>
        <input id={`d-eta-${k}`} name="etaText" defaultValue={m?.etaText ?? ''} maxLength={120} placeholder="например: 1–3 дня" />
        <span className="ops-muted">Показывается покупателю как есть. Сроки сайт не вычисляет.</span>
      </div>
      <div className="adm-field">
        <label htmlFor={`d-reg-${k}`}>География (регионы и города, по одному в строке)</label>
        <textarea id={`d-reg-${k}`} name="regions" className="ops-textarea" defaultValue={(m?.regions ?? []).join('\n')} maxLength={4000} />
        <label>
          <input type="checkbox" name="wholeCountry" defaultChecked={!m?.regions} /> Вся страна (список выше не используется)
        </label>
        <span className="ops-muted">Адрес заказа должен содержать одно из названий. Проверяется на сервере.</span>
      </div>
      <div className="adm-field">
        <label htmlFor={`d-sort-${k}`}>Порядок</label>
        <input id={`d-sort-${k}`} name="sort" inputMode="numeric" defaultValue={m?.sort ?? 100} />
      </div>
      <label>
        <input type="checkbox" name="requiresAddress" defaultChecked={m?.requiresAddress ?? true} /> Требуется адрес
      </label>
      <label>
        <input type="checkbox" name="enabled" defaultChecked={m?.enabled ?? true} /> Способ включён
      </label>
      <div className="adm-inline">
        <button type="submit" className="button">
          {m ? 'Сохранить' : 'Добавить способ'}
        </button>
      </div>
    </form>
  );
}

export default async function ShippingSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('shipping.write');
  const sp = await searchParams;
  const methods = deliveryAdmin.list(session);
  return (
    <>
      <PageHeader title="Настройки магазина" description="Доставка и получение заказов" />
      <SettingsTabs current="shipping" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      <p className="ops-muted">
        Внешняя служба доставки не подключена: стоимость и сроки задаёте вы, а «рассчитает менеджер» оставляет цену на согласование. Подключение службы — раздел «Интеграции».
      </p>
      {methods.length === 0 ? (
        <EmptyState title="Способов получения нет">Добавьте хотя бы один, иначе оформление заказа недоступно.</EmptyState>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Способы получения</caption>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Стоимость</th>
                <th scope="col">Бесплатно от</th>
                <th scope="col">Минимум</th>
                <th scope="col">География</th>
                <th scope="col">Срок</th>
                <th scope="col">Статус</th>
                <th scope="col">Действия</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.priceKopecks === null ? 'рассчитает менеджер' : m.priceKopecks === 0 ? 'бесплатно' : formatRub(m.priceKopecks)}</td>
                  <td>{m.freeFromKopecks === null ? '—' : formatRub(m.freeFromKopecks)}</td>
                  <td>{m.minOrderKopecks > 0 ? formatRub(m.minOrderKopecks) : '—'}</td>
                  <td>{m.regions ? `${m.regions.length} шт.: ${m.regions.slice(0, 3).join(', ')}${m.regions.length > 3 ? '…' : ''}` : 'вся страна'}</td>
                  <td>{m.etaText ?? '—'}</td>
                  <td>
                    <span className={`ops-badge ${m.enabled ? 'ops-badge--ok' : 'ops-badge--warn'}`}>{m.enabled ? 'включён' : 'выключен'}</span>
                  </td>
                  <td>
                    <div className="adm-inline">
                      <form action={toggleDeliveryAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="enabled" value={m.enabled ? '0' : '1'} />
                        <button type="submit" className="button button--outline button--small">
                          {m.enabled ? 'Выключить' : 'Включить'}
                        </button>
                      </form>
                      <form action={deleteDeliveryAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <ConfirmButton title="Удалить способ получения?" description="Способ, по которому уже были заказы, удалить нельзя — его можно только выключить." confirmLabel="Удалить" className="button button--outline button--small">
                          Удалить
                        </ConfirmButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Изменить способ</h2>
      {methods.map((m) => (
        <details key={m.id} className="adm-card">
          <summary>{m.name}</summary>
          <MethodForm m={m} />
        </details>
      ))}
      <h2>Новый способ</h2>
      <div className="adm-card">
        <MethodForm m={null} />
      </div>
    </>
  );
}
