import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { hasPermission } from '@/domain/admin/permissions';
import { warehouseReports, warehousesAdmin } from '@/domain/catalog/warehouses';
import { MOVEMENT_KINDS, type MovementKind } from '@/server/db/repositories/warehouses';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { CATALOG_NAV, Flash, fmtIso, int, str, SubNav } from '../_lib/ui';
import { receiveAction, transferAction, writeOffAction } from './actions';

export const metadata: Metadata = { title: 'Склад' };
export const dynamic = 'force-dynamic';

const PAGE = 50;
const TABS = [
  { key: 'stock', label: 'Остатки' },
  { key: 'movements', label: 'Движение и история' },
  { key: 'reserves', label: 'Резервы' },
] as const;
const KIND_LABELS: Record<MovementKind, string> = {
  receipt: 'Приход',
  writeoff: 'Списание вручную',
  transfer: 'Перемещение',
  reserve: 'Резерв под заказ',
  release: 'Снятие резерва',
  order_writeoff: 'Списание по заказу',
};

function dayStart(v: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`).toISOString() : undefined;
}
function dayEnd(v: string): string | undefined {
  const s = dayStart(v);
  return s ? new Date(Date.parse(s) + 86_400_000).toISOString() : undefined;
}

export default async function AdminWarehousePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === str(sp.tab)) ? str(sp.tab) : 'stock';
  const canWrite = hasPermission(session, 'warehouses.write');
  const warehouses = warehousesAdmin.list(session);
  const names = new Map(warehouses.map((w) => [w.id, w.name]));
  const q = str(sp.q).trim().slice(0, 100);
  const wh = int(sp.warehouse, 0) || undefined;
  const page = int(sp.page, 1);
  const offset = (page - 1) * PAGE;

  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const k of ['tab', 'q', 'warehouse', 'low', 'kind', 'from', 'to', 'product']) if (str(sp[k])) p.set(k, str(sp[k]));
    for (const [k, v] of Object.entries(over)) {
      if (v === '') p.delete(k);
      else p.set(k, v);
    }
    return `/admin/warehouse?${p.toString()}`;
  };
  const pager = (total: number) => {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    return (
      <nav className="adm-pager" aria-label="Страницы">
        {page > 1 ? <Link href={link({ page: String(page - 1) })}>← Назад</Link> : null}
        <span>
          Страница {page} из {pages} · всего {total}
        </span>
        {page < pages ? <Link href={link({ page: String(page + 1) })}>Вперёд →</Link> : null}
      </nav>
    );
  };

  const productId = int(sp.product, 0);
  const whOptions = warehouses.filter((w) => w.active);

  let body: ReactNode = null;
  if (tab === 'stock') {
    const low = str(sp.low) === '1';
    const r = warehouseReports.stock(session, { q: q || undefined, warehouseId: wh, lowOnly: low, tracking: str(sp.tracking) === 'all' ? 'all' : 'tracked', limit: PAGE, offset });
    body = (
      <>
        <form method="get" className="adm-filters" role="search" aria-label="Фильтр остатков">
          <input type="hidden" name="tab" value="stock" />
          <div className="adm-field">
            <label htmlFor="w-q">Название или артикул</label>
            <input id="w-q" name="q" type="search" defaultValue={q} maxLength={100} />
          </div>
          <div className="adm-field">
            <label htmlFor="w-wh">Склад</label>
            <select id="w-wh" name="warehouse" defaultValue={wh ? String(wh) : ''}>
              <option value="">Все склады</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <label>
            <input type="checkbox" name="low" value="1" defaultChecked={low} /> Только низкие остатки (≤ {r.threshold})
          </label>
          <label>
            <input type="checkbox" name="tracking" value="all" defaultChecked={str(sp.tracking) === 'all'} /> Показать и товары без учёта
          </label>
          <div className="adm-inline">
            <button type="submit" className="button">
              Показать
            </button>
          </div>
        </form>
        {r.rows.length === 0 ? (
          <EmptyState title="Нет товаров с учётом остатков">Остаток появляется после первого прихода на склад или ввода в карточке товара. Наличие без количества берётся из импорта.</EmptyState>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Остатки по складам</caption>
              <thead>
                <tr>
                  <th scope="col">Товар</th>
                  <th scope="col">Артикул</th>
                  <th scope="col">Остаток</th>
                  <th scope="col">Резерв</th>
                  <th scope="col">Свободно</th>
                  <th scope="col">По складам</th>
                  {canWrite ? <th scope="col">Операция</th> : null}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((p) => {
                  const free = p.stockQty - p.reservedQty;
                  return (
                    <tr key={p.productId}>
                      <td>
                        <Link href={`/admin/catalog/${p.productId}`}>{p.name}</Link>
                      </td>
                      <td>{p.sku ?? '—'}</td>
                      <td>{p.tracked ? p.stockQty : 'не ведётся'}</td>
                      <td>{p.tracked ? p.reservedQty : '—'}</td>
                      <td>
                        {p.tracked ? (
                          <>
                            {free} {free <= r.threshold ? <span className="ops-badge ops-badge--warn">мало</span> : null}
                          </>
                        ) : (
                          <span className={`ops-badge ${p.inStock ? 'ops-badge--ok' : 'ops-badge--warn'}`}>{p.inStock ? 'в наличии' : 'нет'}</span>
                        )}
                      </td>
                      <td>
                        {p.parts
                          .filter((x) => x.qty > 0 || x.reserved > 0)
                          .map((x) => `${names.get(x.warehouseId) ?? '—'}: ${x.qty}${x.reserved ? ` (резерв ${x.reserved})` : ''}`)
                          .join('; ') || '—'}
                      </td>
                      {canWrite ? (
                        <td>
                          <Link href={link({ tab: 'movements', product: String(p.productId) })}>Приход / списание / перемещение</Link>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pager(r.total)}
      </>
    );
  } else if (tab === 'movements') {
    const kind = (MOVEMENT_KINDS as readonly string[]).includes(str(sp.kind)) ? (str(sp.kind) as MovementKind) : undefined;
    const r = warehouseReports.movements(session, { q: q || undefined, warehouseId: wh, kind, from: dayStart(str(sp.from)), to: dayEnd(str(sp.to)), limit: PAGE, offset });
    body = (
      <>
        {canWrite ? (
          <section className="adm-card" aria-labelledby="ops-h">
            <h2 id="ops-h">Операция с остатком</h2>
            <p className="ops-muted">Причина обязательна. Остаток не уходит ниже нуля, зарезервированное не списывается и не перемещается.</p>
            <div className="adm-inline">
              {(
                [
                  ['receive', 'Оприходовать', receiveAction],
                  ['writeoff', 'Списать', writeOffAction],
                ] as const
              ).map(([key, label, action]) => (
                <form key={key} action={action} className="adm-card" aria-label={label}>
                  <h3>{label}</h3>
                  <div className="adm-field">
                    <label htmlFor={`${key}-p`}>ID товара</label>
                    <input id={`${key}-p`} name="productId" inputMode="numeric" defaultValue={productId || ''} required />
                  </div>
                  <div className="adm-field">
                    <label htmlFor={`${key}-w`}>Склад</label>
                    <select id={`${key}-w`} name="warehouseId" required>
                      {(key === 'receive' ? whOptions : warehouses).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="adm-field">
                    <label htmlFor={`${key}-q`}>Количество</label>
                    <input id={`${key}-q`} name="qty" inputMode="numeric" required />
                  </div>
                  <div className="adm-field">
                    <label htmlFor={`${key}-r`}>Причина</label>
                    <input id={`${key}-r`} name="reason" maxLength={300} required />
                  </div>
                  <button type="submit" className="button">
                    {label}
                  </button>
                </form>
              ))}
              <form action={transferAction} className="adm-card" aria-label="Переместить">
                <h3>Переместить между складами</h3>
                <div className="adm-field">
                  <label htmlFor="tr-p">ID товара</label>
                  <input id="tr-p" name="productId" inputMode="numeric" defaultValue={productId || ''} required />
                </div>
                <div className="adm-field">
                  <label htmlFor="tr-f">Откуда</label>
                  <select id="tr-f" name="fromWarehouseId" required>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="adm-field">
                  <label htmlFor="tr-t">Куда</label>
                  <select id="tr-t" name="toWarehouseId" required>
                    {whOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="adm-field">
                  <label htmlFor="tr-q">Количество</label>
                  <input id="tr-q" name="qty" inputMode="numeric" required />
                </div>
                <div className="adm-field">
                  <label htmlFor="tr-r">Причина</label>
                  <input id="tr-r" name="reason" maxLength={300} required />
                </div>
                <button type="submit" className="button">
                  Переместить
                </button>
              </form>
            </div>
          </section>
        ) : null}
        <form method="get" className="adm-filters" role="search" aria-label="Фильтр истории">
          <input type="hidden" name="tab" value="movements" />
          <div className="adm-field">
            <label htmlFor="m-q">Товар, артикул или причина</label>
            <input id="m-q" name="q" type="search" defaultValue={q} maxLength={100} />
          </div>
          <div className="adm-field">
            <label htmlFor="m-wh">Склад</label>
            <select id="m-wh" name="warehouse" defaultValue={wh ? String(wh) : ''}>
              <option value="">Все склады</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="adm-field">
            <label htmlFor="m-kind">Вид операции</label>
            <select id="m-kind" name="kind" defaultValue={kind ?? ''}>
              <option value="">Любой</option>
              {MOVEMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="adm-field">
            <label htmlFor="m-from">С даты</label>
            <input id="m-from" name="from" type="date" defaultValue={str(sp.from)} />
          </div>
          <div className="adm-field">
            <label htmlFor="m-to">По дату</label>
            <input id="m-to" name="to" type="date" defaultValue={str(sp.to)} />
          </div>
          <div className="adm-inline">
            <button type="submit" className="button">
              Показать
            </button>
          </div>
        </form>
        {r.rows.length === 0 ? (
          <EmptyState title="Операций не найдено" />
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">История операций с остатками</caption>
              <thead>
                <tr>
                  <th scope="col">Время</th>
                  <th scope="col">Товар</th>
                  <th scope="col">Склад</th>
                  <th scope="col">Изменение</th>
                  <th scope="col">Остаток после</th>
                  <th scope="col">Причина</th>
                  <th scope="col">Кто</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtIso(m.createdAt)}</td>
                    <td>
                      <Link href={`/admin/catalog/${m.productId}`}>{m.productName}</Link>
                    </td>
                    <td>{m.movedQty !== null ? `${m.warehouseName ?? '—'} → ${m.toWarehouseName ?? '—'}` : (m.warehouseName ?? 'по заказу')}</td>
                    <td>
                      {m.movedQty !== null ? `перемещено ${m.movedQty}` : m.delta !== 0 ? (m.delta > 0 ? `+${m.delta}` : String(m.delta)) : m.reservedDelta !== 0 ? `резерв ${m.reservedDelta > 0 ? '+' : ''}${m.reservedDelta}` : '0'}
                    </td>
                    <td>{m.qtyAfter}</td>
                    <td>
                      {m.reason}
                      {m.ref ? ` (${m.ref})` : ''}
                    </td>
                    <td>{m.staffName ?? 'система'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pager(r.total)}
      </>
    );
  } else {
    const r = warehouseReports.reserves(session, { q: q || undefined, limit: PAGE, offset });
    body = (
      <>
        <form method="get" className="adm-filters" role="search" aria-label="Поиск резервов">
          <input type="hidden" name="tab" value="reserves" />
          <div className="adm-field">
            <label htmlFor="r-q">Товар, артикул или номер заказа</label>
            <input id="r-q" name="q" type="search" defaultValue={q} maxLength={100} />
          </div>
          <div className="adm-inline">
            <button type="submit" className="button">
              Показать
            </button>
          </div>
        </form>
        {r.rows.length === 0 ? (
          <EmptyState title="Резервов нет">Резерв появляется при оформлении заказа на товар с учётом остатка и снимается при отмене или списывается при отгрузке.</EmptyState>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Резервы под заказы</caption>
              <thead>
                <tr>
                  <th scope="col">Заказ</th>
                  <th scope="col">Статус заказа</th>
                  <th scope="col">Товар</th>
                  <th scope="col">В резерве, шт.</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={`${x.ref}-${x.productId}`}>
                    <td>{x.orderNumber ? <Link href={`/admin/orders/${x.orderNumber}`}>{x.orderNumber}</Link> : x.ref}</td>
                    <td>{x.orderStatus ?? '—'}</td>
                    <td>{x.productName}</td>
                    <td>{x.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pager(r.total)}
      </>
    );
  }

  const violations = warehouseReports.violations(session);
  return (
    <>
      <h1>Склад</h1>
      <SubNav items={CATALOG_NAV} current="/admin/warehouse" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Операция выполнена." />
      <SubNav items={TABS.map((t) => ({ href: link({ tab: t.key, page: '' }), label: t.label }))} current={link({ tab, page: '' })} />
      {violations.length > 0 ? (
        <p className="adm-flash adm-flash--error" role="alert">
          Обнаружено расхождение остатков по складам у товаров: {violations.length}. Сообщите администратору.
        </p>
      ) : null}
      {body}
    </>
  );
}
