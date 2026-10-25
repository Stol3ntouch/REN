import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { requestsRepo, type RequestKind, type RequestRow, type RequestStatus } from '@/server/db/repositories/requests';
import { reviewsRepo, type ReviewRow, type ReviewStatus } from '@/server/db/repositories/reviews';
import { NotFoundError } from '@/server/http/errors';
import { parseForm, requestUpdateSchema } from './schemas';

type Opts = { db?: Db; now?: number };

export const REQUEST_KINDS: readonly RequestKind[] = ['repair', 'callback', 'contact', 'question'];
export const REQUEST_STATUSES: readonly RequestStatus[] = ['new', 'in_work', 'waiting', 'closed', 'diagnostics', 'awaiting_approval', 'in_repair', 'awaiting_parts', 'ready', 'completed', 'cancelled'];

const listFilter = z.object({
  kind: z.enum(['repair', 'callback', 'contact', 'question']).optional().catch(undefined),
  status: z.enum(['new', 'in_work', 'waiting', 'closed', 'diagnostics', 'awaiting_approval', 'in_repair', 'awaiting_parts', 'ready', 'completed', 'cancelled']).optional().catch(undefined),
});

/** Заявки и вопросы. Право requests.write: manager и admin. Каждый метод проверяет право сам. */
export const requestsAdmin = {
  list(session: StaffSession | null, filter: unknown = {}, opts: Opts = {}): RequestRow[] {
    requirePermission(session, 'requests.write');
    return requestsRepo.list(opts.db ?? getDb(), { ...listFilter.parse(filter ?? {}), limit: 200 });
  },

  /** Смена статуса и/или заметки; запись в аудит (контакты в аудите маскируются). */
  update(session: StaffSession | null, id: number, input: unknown, opts: Opts = {}): RequestRow {
    requirePermission(session, 'requests.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const patch = parseForm(requestUpdateSchema, input);
    return withTransaction(db, () => {
      const before = requestsRepo.findById(db, id);
      if (!before) throw new NotFoundError('Заявка не найдена');
      // прежнее «done» → «закрыто» (обращения) / «завершена» (ремонт)
      const status = (patch.status === 'done' ? (before.kind === 'repair' ? 'completed' : 'closed') : patch.status) as RequestStatus | undefined;
      requestsRepo.update(db, id, { status, note: patch.note === undefined ? undefined : patch.note || null, handledBy: session.staffId, now });
      const after = requestsRepo.findById(db, id)!;
      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: 'request.update',
          entity: 'request',
          entityId: id,
          before: { number: before.number, status: before.status, note: before.note },
          after: { number: after.number, status: after.status, note: after.note },
        },
        { db, now },
      );
      return after;
    });
  },
};

const reviewFilter = z.object({ status: z.enum(['pending', 'published', 'rejected']).optional().catch(undefined) });
const decisionSchema = z.enum(['published', 'rejected'], { error: 'Решение: опубликовать или отклонить' });

/** Модерация отзывов. Право reviews.moderate: manager и admin. */
export const reviewsAdmin = {
  list(session: StaffSession | null, filter: unknown = {}, opts: Opts = {}): ReviewRow[] {
    requirePermission(session, 'reviews.moderate');
    return reviewsRepo.list(opts.db ?? getDb(), { ...reviewFilter.parse(filter ?? {}), limit: 200 });
  },

  /** pending → published | rejected (и обратно между ними: снять с публикации = отклонить). Пишет аудит. */
  moderate(session: StaffSession | null, id: number, decision: unknown, opts: Opts = {}): ReviewRow {
    requirePermission(session, 'reviews.moderate');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const status: ReviewStatus = parseForm(z.object({ decision: decisionSchema }), { decision }).decision;
    return withTransaction(db, () => {
      const before = reviewsRepo.findById(db, id);
      if (!before) throw new NotFoundError('Отзыв не найден');
      reviewsRepo.setStatus(db, id, status, session.staffId, now);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'review.moderate', entity: 'review', entityId: id, before: { status: before.status }, after: { status, productId: before.productId } },
        { db, now },
      );
      return reviewsRepo.findById(db, id)!;
    });
  },
};
