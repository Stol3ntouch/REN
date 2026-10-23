import Link from 'next/link';
import type { RequestKind, RequestRow, RequestStatus } from '@/server/db/repositories/requests';
import { EmptyState } from '@/ui/states';
import { fmtTime } from '../_lib/ui';
import { updateRequestAction } from './actions';

export const KIND_LABELS: Record<RequestKind, string> = { repair: 'Ремонт', callback: 'Звонок', contact: 'Сообщение', question: 'Вопрос о товаре' };
export const STATUS_LABELS: Record<RequestStatus, string> = { new: 'Новая', in_work: 'В работе', done: 'Выполнена', cancelled: 'Отменена' };
const STATUS_CLASS: Record<RequestStatus, string> = { new: 'ops-badge--warn', in_work: '', done: 'ops-badge--ok', cancelled: '' };
const CONTACT_LABELS = { phone: 'звонок', email: 'почта', messenger: 'мессенджер' } as const;

/** Список заявок с формой статуса и заметки в раскрывающемся блоке. Контакты видны только сотрудникам (страница под requests.write). */
export function RequestsTable({ rows, back }: { rows: RequestRow[]; back: '/admin/requests' | '/admin/questions' }) {
  if (rows.length === 0) return <EmptyState title="Заявок нет" />;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <caption className="visually-hidden">Заявки</caption>
        <thead>
          <tr>
            <th scope="col">Номер</th>
            <th scope="col">Когда</th>
            <th scope="col">Вид</th>
            <th scope="col">Клиент</th>
            <th scope="col">Суть</th>
            <th scope="col">Статус</th>
            <th scope="col">Обработка</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.number}</td>
              <td>{fmtTime(r.createdAt)}</td>
              <td>{KIND_LABELS[r.kind]}</td>
              <td>
                {r.name}
                {r.phone ? (
                  <>
                    <br />
                    <a href={`tel:${r.phone}`}>{r.phone}</a>
                  </>
                ) : null}
                {r.email ? (
                  <>
                    <br />
                    <a href={`mailto:${r.email}`}>{r.email}</a>
                  </>
                ) : null}
                {r.preferredContact ? <span className="ops-muted"> (связь: {CONTACT_LABELS[r.preferredContact]})</span> : null}
              </td>
              <td>
                {r.equipmentType ? <strong>{r.equipmentType}. </strong> : null}
                {r.productName && r.productId ? (
                  <>
                    Товар: <Link href={`/admin/catalog/${r.productId}`}>{r.productName}</Link>.{' '}
                  </>
                ) : null}
                {r.message}
              </td>
              <td>
                <span className={`ops-badge ${STATUS_CLASS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
              </td>
              <td>
                <details>
                  <summary>{r.note ? 'Заметка и статус' : 'Изменить'}</summary>
                  <form action={updateRequestAction} className="adm-form">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="back" value={back} />
                    <div className="adm-field">
                      <label htmlFor={`st-${r.id}`}>Статус</label>
                      <select id={`st-${r.id}`} name="status" defaultValue={r.status}>
                        {(Object.keys(STATUS_LABELS) as RequestStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="adm-field">
                      <label htmlFor={`nt-${r.id}`}>Заметка</label>
                      <textarea id={`nt-${r.id}`} name="note" rows={3} maxLength={2000} defaultValue={r.note ?? ''} className="ops-textarea" />
                    </div>
                    <button type="submit" className="button button--small">
                      Сохранить
                    </button>
                  </form>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
