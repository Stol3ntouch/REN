import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { inquiriesOps } from '@/domain/requests/sales-admin';
import { CHANNEL_LABELS, INQUIRY_LABELS, INQUIRY_STATUSES } from '@/domain/requests/workflow';
import { requireStaffPage } from '@/ui/admin/guard';
import { FlashToast, PageHeader, SelectField, TextAreaField } from '@/ui/admin/kit';
import { fmtTime } from '../../_lib/ui';
import { assignInquiryAction, commentInquiryAction, setInquiryStatusAction } from '../actions';
import { RequestStatusBadge, RequestTimeline } from '../parts';

export const metadata: Metadata = { title: 'Обращение' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function InquiryPage({ params, searchParams }: Props) {
  const session = await requireStaffPage('inquiries.read');
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const detail = inquiriesOps.get(session, Number(id));
  if (!detail) notFound();
  const { request: r } = detail;
  const staff = inquiriesOps.staffForAssignment(session);
  const staffName = new Map(staff.map((s) => [String(s.id), s.label]));
  const canWrite = hasPermission(session, 'inquiries.write');

  return (
    <>
      <FlashToast ok={sp.ok} error={sp.error} />
      <p>
        <Link href="/admin/inquiries">← Все обращения</Link>
      </p>
      <PageHeader title={`Обращение ${r.number}`} description={CHANNEL_LABELS[r.kind]} />
      <div className="ak-grid-2">
        <div className="ak-stack">
          <section className="ak-card" aria-labelledby="iq-main">
            <h2 id="iq-main">Обращение</h2>
            <dl>
              <dt>Статус</dt>
              <dd>
                <RequestStatusBadge row={r} />
              </dd>
              <dt>Поступило</dt>
              <dd>{fmtTime(r.createdAt)}</dd>
              <dt>Имя</dt>
              <dd>{r.name}</dd>
              <dt>Телефон</dt>
              <dd>{r.phone ?? '—'}</dd>
              <dt>Email</dt>
              <dd>{r.email ?? '—'}</dd>
              {r.productName ? (
                <>
                  <dt>Товар</dt>
                  <dd>{r.productName}</dd>
                </>
              ) : null}
              <dt>Тема</dt>
              <dd>{r.subject ?? '—'}</dd>
              <dt>Текст</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{r.message ?? '—'}</dd>
              <dt>Ответственный</dt>
              <dd>{r.assignedStaffId ? (staffName.get(String(r.assignedStaffId)) ?? `№${r.assignedStaffId}`) : 'не назначен'}</dd>
            </dl>
          </section>
          <RequestTimeline
            kind={r.kind}
            events={detail.events}
            comments={detail.comments}
            staffName={(sid) => (sid ? (staffName.get(sid) ?? `сотрудник №${sid}`) : 'сотрудник')}
            commentForm={
              canWrite ? (
                <form action={commentInquiryAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <TextAreaField name="body" label="Новый комментарий" rows={3} maxLength={2000} required />
                  <button type="submit" className="ak-btn">
                    Добавить
                  </button>
                </form>
              ) : null
            }
          />
        </div>
        {canWrite ? (
          <div className="ak-stack">
            <form action={setInquiryStatusAction} className="ak-card">
              <input type="hidden" name="id" value={r.id} />
              <h2>Статус</h2>
              <SelectField name="status" label="Новый статус" defaultValue={r.status} options={INQUIRY_STATUSES.map((s) => ({ value: s, label: INQUIRY_LABELS[s], disabled: s === r.status }))} />
              <TextAreaField name="note" label="Комментарий к смене (необязательно)" rows={2} maxLength={2000} />
              <button type="submit" className="ak-btn ak-btn--primary">
                Сменить статус
              </button>
            </form>
            <form action={assignInquiryAction} className="ak-card">
              <input type="hidden" name="id" value={r.id} />
              <h2>Ответственный</h2>
              <SelectField name="staffId" label="Сотрудник" defaultValue={r.assignedStaffId ? String(r.assignedStaffId) : ''} placeholder="Не назначен" options={staff.map((s) => ({ value: String(s.id), label: s.label }))} />
              <button type="submit" className="ak-btn">
                Назначить
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </>
  );
}
