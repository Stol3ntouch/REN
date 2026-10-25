import type { ReactNode } from 'react';
import { statusLabel } from '@/domain/requests/workflow';
import type { RequestCommentRow, RequestEventRow, RequestRow } from '@/server/db/repositories/requests';
import { StatusBadge, type StatusTone } from '@/ui/admin/kit';
import { fmtTime } from '../_lib/ui';

const TONE: Partial<Record<string, StatusTone>> = {
  new: 'warning',
  in_work: 'info',
  diagnostics: 'info',
  in_repair: 'info',
  waiting: 'neutral',
  awaiting_approval: 'neutral',
  awaiting_parts: 'neutral',
  ready: 'success',
  completed: 'success',
  closed: 'success',
  cancelled: 'danger',
};

export function RequestStatusBadge({ row }: { row: Pick<RequestRow, 'kind' | 'status'> }) {
  return <StatusBadge tone={TONE[row.status] ?? 'neutral'}>{statusLabel(row.kind, row.status)}</StatusBadge>;
}

const EVENT_TEXT: Record<RequestEventRow['kind'], string> = {
  created: 'Заявка поступила',
  status: 'Статус',
  assigned: 'Ответственный',
  comment: 'Комментарий',
  edit: 'Правка',
  photo: 'Фото',
};

/** Комментарии сотрудников и история обработки (внутренние, клиенту не показываются). */
export function RequestTimeline({
  kind,
  events,
  comments,
  staffName,
  commentForm,
}: {
  kind: RequestRow['kind'];
  events: RequestEventRow[];
  comments: RequestCommentRow[];
  staffName: (id: string | null) => string;
  commentForm?: ReactNode;
}) {
  return (
    <>
      <section className="ak-card" aria-labelledby="rq-comments">
        <h2 id="rq-comments">Комментарии сотрудников</h2>
        {comments.length === 0 ? <p className="ak-muted">Комментариев пока нет.</p> : null}
        <ul className="ak-list">
          {comments.map((c) => (
            <li key={c.id}>
              <strong>{c.authorName ?? 'Сотрудник'}</strong> · {fmtTime(c.createdAt)}
              <br />
              {c.body}
            </li>
          ))}
        </ul>
        {commentForm}
      </section>
      <section className="ak-card" aria-labelledby="rq-history">
        <h2 id="rq-history">История обработки</h2>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="timeline__time">{fmtTime(e.at)}</span> — {EVENT_TEXT[e.kind]}
              {e.kind === 'status' && e.toStatus ? `: ${e.fromStatus ? statusLabel(kind, e.fromStatus) : '—'} → ${statusLabel(kind, e.toStatus)}` : ''} (
              {e.actorType === 'staff' ? staffName(e.actorId) : e.actorType === 'system' ? 'система' : 'клиент'}){e.note && e.kind !== 'comment' ? `: ${e.note}` : ''}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
