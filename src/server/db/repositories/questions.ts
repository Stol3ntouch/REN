import type { Db } from '../connection';
import { requestsRepo, type RequestRow, type RequestStatus } from './requests';

/** Вопросы о товаре — заявки kind='question' (хранятся в requests: аналитика T10 считает их одним источником). */
export const questionsRepo = {
  list(db: Db, f: { status?: RequestStatus; limit?: number; offset?: number } = {}): RequestRow[] {
    return requestsRepo.list(db, { kind: 'question', ...f });
  },
};
