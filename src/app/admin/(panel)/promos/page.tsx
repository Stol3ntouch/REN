import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { promoOps } from '@/domain/ordering/admin-ops';
import { formatRub } from '@/domain/pricing/format';
import type { PromoRow } from '@/server/db/repositories/promos';
import '@/ui/cart/admin-orders.css';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { deletePromoAction, savePromoAction } from './actions';

export const metadata: Metadata = { title: 'Цены и акции' };
export const dynamic = 'force-dynamic';

const MSK = 'Europe/Moscow';
const dateOnly = (ms: number | null) => (ms === null ? '' : new Intl.DateTimeFormat('sv-SE', { timeZone: MSK }).format(new Date(ms)));
const human = (ms: number | null) => (ms === null ? '—' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: MSK }).format(new Date(ms)));
const rubInput = (kopecks: number) => (kopecks % 100 === 0 ? String(kopecks / 100) : (kopecks / 100).toFixed(2).replace('.', ','));

function PromoForm({ promo }: { promo?: PromoRow }) {
  const id = promo?.id ?? 'new';
  return (
    <form action={savePromoAction} className="adm-card">
      <h2>{promo ? `Промокод ${promo.code}` : 'Новый промокод'}</h2>
      {promo ? <input type="hidden" name="id" value={promo.id} /> : null}
      <div className="adm-filters">
        <div className="adm-field">
          <label htmlFor={`p-code-${id}`}>Код</label>
          <input id={`p-code-${id}`} name="code" required maxLength={32} defaultValue={promo?.code} />
        </div>
        <div className="adm-field">
          <label htmlFor={`p-type-${id}`}>Тип</label>
          <select id={`p-type-${id}`} name="type" defaultValue={promo?.type ?? 'percent'}>
            <option value="percent">Процент</option>
            <option value="fixed">Сумма, ₽</option>
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor={`p-value-${id}`}>Размер (% или ₽)</label>
          <input id={`p-value-${id}`} name="value" required inputMode="decimal" defaultValue={promo ? (promo.type === 'percent' ? promo.value : rubInput(promo.value)) : ''} />
        </div>
        <div className="adm-field">
          <label htmlFor={`p-from-${id}`}>Действует с</label>
          <input id={`p-from-${id}`} name="startsAt" type="date" defaultValue={dateOnly(promo?.startsAt ?? null)} />
        </div>
        <div className="adm-field">
          <label htmlFor={`p-to-${id}`}>Действует по (включительно)</label>
          <input id={`p-to-${id}`} name="endsAt" type="date" defaultValue={dateOnly(promo?.endsAt ?? null)} />
        </div>
        <div className="adm-field">
          <label htmlFor={`p-limit-${id}`}>Лимит использований</label>
          <input id={`p-limit-${id}`} name="usageLimit" inputMode="numeric" defaultValue={promo?.usageLimit ?? ''} />
        </div>
        <div className="adm-field">
          <label htmlFor={`p-min-${id}`}>Мин. сумма заказа, ₽</label>
          <input id={`p-min-${id}`} name="minSubtotal" inputMode="decimal" defaultValue={promo && promo.minSubtotalKopecks > 0 ? rubInput(promo.minSubtotalKopecks) : ''} />
        </div>
      </div>
      <label>
        <input type="checkbox" name="enabled" defaultChecked={promo?.enabled ?? true} /> Включён
      </label>
      <div className="adm-inline">
        <button type="submit" className="button">
          Сохранить
        </button>
        {promo ? (
          <Link href="/admin/promos" className="button button--outline">
            Отмена
          </Link>
        ) : null}
      </div>
    </form>
  );
}

export default async function AdminPromosPage({ searchParams }: { searchParams: Promise<{ edit?: string; ok?: string; error?: string }> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  const promos = promoOps.list(session);
  const canWrite = hasPermission(session.role, 'promos.write');
  const editing = canWrite && sp.edit ? promos.find((p) => String(p.id) === sp.edit) : undefined;

  return (
    <>
      <h1>Цены и акции</h1>
      <h2>Промокоды</h2>
      {sp.ok ? (
        <p className="adm-flash" role="status">
          Сохранено.
        </p>
      ) : null}
      {sp.error ? (
        <p className="adm-flash adm-flash--error" role="alert">
          {sp.error}
        </p>
      ) : null}
      {!canWrite ? <p>У вашей роли права только на просмотр: промокоды меняет администратор.</p> : null}

      {promos.length === 0 ? (
        <EmptyState title="Промокодов пока нет" />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <caption className="visually-hidden">Промокоды</caption>
            <thead>
              <tr>
                <th scope="col">Код</th>
                <th scope="col">Скидка</th>
                <th scope="col">Период</th>
                <th scope="col">Использовано</th>
                <th scope="col">Мин. сумма</th>
                <th scope="col">Статус</th>
                {canWrite ? <th scope="col">Действия</th> : null}
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.type === 'percent' ? `${p.value}%` : formatRub(p.value)}</td>
                  <td>
                    {human(p.startsAt)} — {human(p.endsAt)}
                  </td>
                  <td>
                    {p.usedCount}
                    {p.usageLimit ? ` из ${p.usageLimit}` : ''}
                  </td>
                  <td>{p.minSubtotalKopecks > 0 ? formatRub(p.minSubtotalKopecks) : '—'}</td>
                  <td>{p.enabled ? 'включён' : 'выключен'}</td>
                  {canWrite ? (
                    <td>
                      <div className="adm-inline">
                        <Link href={`/admin/promos?edit=${p.id}`}>Изменить</Link>
                        {p.usedCount === 0 ? (
                          <form action={deletePromoAction}>
                            <input type="hidden" name="id" value={p.id} />
                            <button type="submit" className="button button--outline" aria-label={`Удалить промокод ${p.code}`}>
                              Удалить
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canWrite ? <PromoForm key={editing?.id ?? 'new'} promo={editing} /> : null}
    </>
  );
}
