import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState } from '@/ui/states';
import { auditOps } from '../_lib/audit-ops';
import { ACCESS_NAV, fmtTime, int, str, SubNav } from '../_lib/ui';

export const metadata: Metadata = { title: 'Журнал аудита' };
export const dynamic = 'force-dynamic';

const short = (v: unknown): string => {
  if (v === undefined) return '—';
  const s = JSON.stringify(v);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
};

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('audit.read');
  const sp = await searchParams;
  const filter = { entity: str(sp.entity).trim().slice(0, 60), action: str(sp.action).trim().slice(0, 80), actorId: str(sp.actor).trim().slice(0, 20), page: int(sp.page, 1) };
  const result = auditOps.list(session, filter);
  const link = (page: number) => {
    const p = new URLSearchParams();
    if (filter.entity) p.set('entity', filter.entity);
    if (filter.action) p.set('action', filter.action);
    if (filter.actorId) p.set('actor', filter.actorId);
    p.set('page', String(page));
    return `/admin/audit?${p.toString()}`;
  };

  return (
    <>
      <h1>Журнал аудита</h1>
      <SubNav items={ACCESS_NAV} current="/admin/audit" />
      <p className="ops-muted">Записи нельзя изменить или удалить. Email и телефоны в журнале замаскированы.</p>
      <form method="get" className="adm-filters" role="search" aria-label="Фильтры журнала">
        <div className="adm-field">
          <label htmlFor="au-entity">Объект (order, product, staff…)</label>
          <input id="au-entity" name="entity" defaultValue={filter.entity} maxLength={60} />
        </div>
        <div className="adm-field">
          <label htmlFor="au-action">Действие (price.change…)</label>
          <input id="au-action" name="action" defaultValue={filter.action} maxLength={80} />
        </div>
        <div className="adm-field">
          <label htmlFor="au-actor">Кто (id сотрудника)</label>
          <input id="au-actor" name="actor" defaultValue={filter.actorId} maxLength={20} inputMode="numeric" />
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Найти
          </button>
          <Link href="/admin/audit" className="button button--outline">
            Сбросить
          </Link>
        </div>
      </form>
      {result.rows.length === 0 ? (
        <EmptyState title="Записей нет" />
      ) : (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="visually-hidden">Журнал аудита</caption>
              <thead>
                <tr>
                  <th scope="col">Время</th>
                  <th scope="col">Кто</th>
                  <th scope="col">Действие</th>
                  <th scope="col">Объект</th>
                  <th scope="col">Было</th>
                  <th scope="col">Стало</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtTime(r.at)}</td>
                    <td>{r.actorId ? `${r.actorType} #${r.actorId}` : r.actorType}</td>
                    <td>{r.action}</td>
                    <td>
                      {r.entity}
                      {r.entityId ? ` #${r.entityId}` : ''}
                    </td>
                    <td>
                      <code>{short(r.before)}</code>
                    </td>
                    <td>
                      <code>{short(r.after)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="adm-pager" aria-label="Страницы">
            {result.page > 1 ? <Link href={link(result.page - 1)}>← Назад</Link> : null}
            <span>Страница {result.page}</span>
            {result.hasNext ? <Link href={link(result.page + 1)}>Вперёд →</Link> : null}
          </nav>
        </>
      )}
    </>
  );
}
