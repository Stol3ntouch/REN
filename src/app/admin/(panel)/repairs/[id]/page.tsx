import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { repairsOps } from '@/domain/requests/sales-admin';
import { REPAIR_LABELS, REPAIR_PHOTO_LIMIT, REPAIR_TRANSITIONS, isRepairStatus } from '@/domain/requests/workflow';
import { requireStaffPage } from '@/ui/admin/guard';
import { FlashToast, FormField, PageHeader, SelectField, TextAreaField } from '@/ui/admin/kit';
import { fmtTime } from '../../_lib/ui';
import { RequestStatusBadge, RequestTimeline } from '../../inquiries/parts';
import { addRepairPhotoAction, assignRepairAction, commentRepairAction, setRepairStatusAction, updateRepairAction } from '../actions';

export const metadata: Metadata = { title: 'Заявка на ремонт' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function RepairPage({ params, searchParams }: Props) {
  const session = await requireStaffPage('repair.write');
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const detail = repairsOps.get(session, Number(id));
  if (!detail) notFound();
  const { request: r } = detail;
  const staff = repairsOps.staffForAssignment(session);
  const staffName = new Map(staff.map((s) => [String(s.id), s.label]));
  const next = isRepairStatus(r.status) ? REPAIR_TRANSITIONS[r.status] : [];

  return (
    <>
      <FlashToast ok={sp.ok} error={sp.error} />
      <p>
        <Link href="/admin/repairs">← Все заявки на ремонт</Link>
      </p>
      <PageHeader title={`Заявка ${r.number}`} description={`Поступила ${fmtTime(r.createdAt)}`} />
      <div className="ak-grid-2">
        <div className="ak-stack">
          <form action={updateRepairAction} className="ak-card">
            <input type="hidden" name="id" value={r.id} />
            <h2>
              Заявка <RequestStatusBadge row={r} />
            </h2>
            <div className="ak-form-grid">
              <FormField name="equipmentType" label="Тип техники" defaultValue={r.equipmentType ?? ''} maxLength={100} />
              <FormField name="brand" label="Бренд" defaultValue={r.repairBrand ?? ''} maxLength={80} />
              <FormField name="model" label="Модель" defaultValue={r.repairModel ?? ''} maxLength={80} />
              <FormField name="phone" label="Телефон" defaultValue={r.phone ?? ''} maxLength={30} />
              <FormField name="email" label="Email" type="email" defaultValue={r.email ?? ''} maxLength={254} />
            </div>
            <TextAreaField name="message" label="Описание неисправности" defaultValue={r.message ?? ''} rows={4} maxLength={2000} />
            <p className="ak-muted">Клиент: {r.name}. Способ связи: {r.preferredContact ?? '—'}. Ответственный: {r.assignedStaffId ? (staffName.get(String(r.assignedStaffId)) ?? `№${r.assignedStaffId}`) : 'не назначен'}.</p>
            <button type="submit" className="ak-btn">
              Сохранить данные
            </button>
          </form>

          <section className="ak-card" aria-labelledby="rp-photos">
            <h2 id="rp-photos">
              Фото ({detail.photos.length} из {REPAIR_PHOTO_LIMIT})
            </h2>
            {detail.photos.length === 0 ? <p className="ak-muted">Фото не приложены.</p> : null}
            <ul className="ak-photo-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', listStyle: 'none', padding: 0 }}>
              {detail.photos.map((p, i) => (
                <li key={p.id}>
                  <a href={`/admin/api/repairs/${r.id}/photos/${p.id}`} target="_blank" rel="noopener">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/admin/api/repairs/${r.id}/photos/${p.id}`} alt={`Фото ${i + 1} к заявке ${r.number}`} width={120} height={Math.round((120 * p.height) / p.width)} loading="lazy" />
                  </a>
                </li>
              ))}
            </ul>
            {detail.photos.length < REPAIR_PHOTO_LIMIT ? (
              <form action={addRepairPhotoAction} encType="multipart/form-data">
                <input type="hidden" name="id" value={r.id} />
                <label htmlFor="rp-photo">Добавить фото (JPG, PNG, WebP, до 5 МБ)</label>
                <input id="rp-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" multiple required />
                <button type="submit" className="ak-btn">
                  Загрузить
                </button>
              </form>
            ) : null}
          </section>

          <RequestTimeline
            kind="repair"
            events={detail.events}
            comments={detail.comments}
            staffName={(sid) => (sid ? (staffName.get(sid) ?? `сотрудник №${sid}`) : 'сотрудник')}
            commentForm={
              <form action={commentRepairAction}>
                <input type="hidden" name="id" value={r.id} />
                <TextAreaField name="body" label="Новый комментарий" rows={3} maxLength={2000} required />
                <button type="submit" className="ak-btn">
                  Добавить
                </button>
              </form>
            }
          />
        </div>
        <div className="ak-stack">
          {next.length > 0 ? (
            <form action={setRepairStatusAction} className="ak-card">
              <input type="hidden" name="id" value={r.id} />
              <h2>Статус</h2>
              <SelectField name="status" label="Новый статус" options={next.map((s) => ({ value: s, label: REPAIR_LABELS[s] }))} required />
              <TextAreaField name="note" label="Комментарий к смене (необязательно)" rows={2} maxLength={2000} hint="Клиенту уйдёт письмо о новом статусе, если указан email" />
              <button type="submit" className="ak-btn ak-btn--primary">
                Сменить статус
              </button>
            </form>
          ) : (
            <p className="ak-card">Заявка закрыта: из статуса «{isRepairStatus(r.status) ? REPAIR_LABELS[r.status] : r.status}» переходов нет.</p>
          )}
          <form action={assignRepairAction} className="ak-card">
            <input type="hidden" name="id" value={r.id} />
            <h2>Ответственный</h2>
            <SelectField name="staffId" label="Сотрудник" defaultValue={r.assignedStaffId ? String(r.assignedStaffId) : ''} placeholder="Не назначен" options={staff.map((s) => ({ value: String(s.id), label: s.label }))} />
            <button type="submit" className="ak-btn">
              Назначить
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
