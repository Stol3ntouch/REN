import type { Metadata } from 'next';
import Link from 'next/link';
import { warehouseReports, warehousesAdmin, type WarehouseView } from '@/domain/catalog/warehouses';
import { requireStaffPage } from '@/ui/admin/guard';
import { ConfirmButton, PageHeader } from '@/ui/admin/kit';
import { Flash, str } from '../../_lib/ui';
import { SettingsTabs } from '../SettingsTabs';
import { deleteWarehouseAction, saveThresholdAction, saveWarehouseAction, setDefaultWarehouseAction } from './actions';

export const metadata: Metadata = { title: 'Склады' };
export const dynamic = 'force-dynamic';

function WarehouseForm({ w }: { w: WarehouseView | null }) {
  const k = w?.id ?? 'new';
  return (
    <form action={saveWarehouseAction} aria-label={w ? `Склад «${w.name}»` : 'Новый склад'}>
      {w ? <input type="hidden" name="id" value={w.id} /> : null}
      <div className="adm-field">
        <label htmlFor={`w-name-${k}`}>Название</label>
        <input id={`w-name-${k}`} name="name" defaultValue={w?.name ?? ''} maxLength={100} required />
      </div>
      <div className="adm-field">
        <label htmlFor={`w-addr-${k}`}>Адрес / расположение</label>
        <input id={`w-addr-${k}`} name="address" defaultValue={w?.address ?? ''} maxLength={300} />
      </div>
      <div className="adm-field">
        <label htmlFor={`w-sort-${k}`}>Порядок</label>
        <input id={`w-sort-${k}`} name="sort" inputMode="numeric" defaultValue={w?.sort ?? 100} />
      </div>
      <label>
        <input type="checkbox" name="active" defaultChecked={w?.active ?? true} /> Склад действует
      </label>
      <div className="adm-inline">
        <button type="submit" className="button">
          {w ? 'Сохранить' : 'Добавить склад'}
        </button>
      </div>
    </form>
  );
}

export default async function WarehousesSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('warehouses.write');
  const sp = await searchParams;
  const list = warehousesAdmin.list(session);
  const threshold = warehouseReports.threshold(session);
  return (
    <>
      <PageHeader title="Настройки магазина" description="Склады и остатки" actions={<Link className="ak-btn ak-btn--outline" href="/admin/warehouse">Открыть «Склад»</Link>} />
      <SettingsTabs current="warehouses" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      <p className="ops-muted">По умолчанию один склад. Остаток товара — сумма остатков по складам. Приход, списание и перемещения — на странице «Склад».</p>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <caption className="visually-hidden">Склады</caption>
          <thead>
            <tr>
              <th scope="col">Склад</th>
              <th scope="col">Адрес</th>
              <th scope="col">Остаток, шт.</th>
              <th scope="col">В резерве</th>
              <th scope="col">Товаров</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.id}>
                <td>{w.name}</td>
                <td>{w.address ?? '—'}</td>
                <td>{w.qty}</td>
                <td>{w.reserved}</td>
                <td>{w.products}</td>
                <td>
                  <span className={`ops-badge ${w.active ? 'ops-badge--ok' : 'ops-badge--warn'}`}>{w.isDefault ? 'по умолчанию' : w.active ? 'действует' : 'отключён'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Изменить склад</h2>
      {list.map((w) => (
        <details key={w.id} className="adm-card">
          <summary>{w.name}</summary>
          <WarehouseForm w={w} />
          <div className="adm-inline">
            {!w.isDefault && w.active ? (
              <form action={setDefaultWarehouseAction}>
                <input type="hidden" name="id" value={w.id} />
                <button type="submit" className="button button--outline">
                  Сделать складом по умолчанию
                </button>
              </form>
            ) : null}
            {!w.isDefault ? (
              <form action={deleteWarehouseAction}>
                <input type="hidden" name="id" value={w.id} />
                <ConfirmButton title="Удалить склад?" description="Удалить можно только склад без остатков и без истории; иначе отключите его." confirmLabel="Удалить" className="button button--outline">
                  Удалить
                </ConfirmButton>
              </form>
            ) : null}
          </div>
        </details>
      ))}
      <h2>Новый склад</h2>
      <div className="adm-card">
        <WarehouseForm w={null} />
      </div>

      <section className="adm-card" aria-labelledby="low-h">
        <h2 id="low-h">Низкие остатки</h2>
        <form action={saveThresholdAction}>
          <div className="adm-field">
            <label htmlFor="low-th">Порог свободного остатка, шт.</label>
            <input id="low-th" name="threshold" inputMode="numeric" defaultValue={threshold} />
            <span className="ops-muted">Товары, у которых свободно (остаток − резерв) не больше порога, отмечаются на странице «Склад».</span>
          </div>
          <div className="adm-inline">
            <button type="submit" className="button">
              Сохранить порог
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
