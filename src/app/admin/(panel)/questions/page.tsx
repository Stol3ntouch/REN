import type { Metadata } from 'next';
import { requestsAdmin } from '@/domain/requests/admin-ops';
import { requireStaffPage } from '@/ui/admin/guard';
import { Flash, str, SubNav } from '../_lib/ui';
import { REQUESTS_NAV } from '../requests/nav';
import { RequestsTable } from '../requests/RequestsTable';

export const metadata: Metadata = { title: 'Вопросы о товарах' };
export const dynamic = 'force-dynamic';

export default async function AdminQuestionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('requests.write');
  const sp = await searchParams;
  const rows = requestsAdmin.list(session, { kind: 'question', status: str(sp.status) });
  return (
    <>
      <h1>Вопросы о товарах</h1>
      <SubNav items={REQUESTS_NAV} current="/admin/questions" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      <p className="ops-muted">Ответьте клиенту по указанной почте, затем отметьте вопрос выполненным.</p>
      <RequestsTable rows={rows} back="/admin/questions" />
    </>
  );
}
