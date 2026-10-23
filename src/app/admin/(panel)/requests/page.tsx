import type { Metadata } from 'next';
import Link from 'next/link';
import { requestsAdmin } from '@/domain/requests/admin-ops';
import { requireStaffPage } from '@/ui/admin/guard';
import { Flash, str, SubNav } from '../_lib/ui';
import { KIND_LABELS, RequestsTable, STATUS_LABELS } from './RequestsTable';
import { REQUESTS_NAV } from './nav';

export const metadata: Metadata = { title: 'Заявки' };
export const dynamic = 'force-dynamic';

export default async function AdminRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('requests.write');
  const sp = await searchParams;
  const filter = { kind: str(sp.kind), status: str(sp.status) };
  const rows = requestsAdmin.list(session, filter);

  return (
    <>
      <h1>Заявки</h1>
      <SubNav items={REQUESTS_NAV} current="/admin/requests" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      <form method="get" className="adm-filters" role="search" aria-label="Фильтры заявок">
        <div className="adm-field">
          <label htmlFor="rq-kind">Вид</label>
          <select id="rq-kind" name="kind" defaultValue={filter.kind}>
            <option value="">Все</option>
            {Object.entries(KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor="rq-status">Статус</label>
          <select id="rq-status" name="status" defaultValue={filter.status}>
            <option value="">Все</option>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Показать
          </button>
          <Link href="/admin/requests" className="button button--outline">
            Сбросить
          </Link>
        </div>
      </form>
      <RequestsTable rows={rows} back="/admin/requests" />
    </>
  );
}
