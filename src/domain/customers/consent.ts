import { getDb, type Db } from '@/server/db/connection';
import { consentsRepo } from '@/server/db/repositories/consents';

export type ConsentInput = {
  kind: 'privacy' | 'marketing' | 'terms';
  /** Форма, где дано согласие: 'register', 'callback', 'repair', 'checkout', ... */
  source: string;
  userId?: number | null;
  guestId?: string | null;
  /** Email/телефон, на которые дано согласие (если нет userId). Не лишнее: доказательство согласия. */
  subject?: string | null;
  textVersion?: string;
};

/** Запись согласия на обработку данных. Вызывается каждой публичной формой с чекбоксом (правило 7). */
export const consent = {
  record(input: ConsentInput, opts: { db?: Db; now?: number } = {}): number {
    return consentsRepo.insert(opts.db ?? getDb(), {
      kind: input.kind,
      source: input.source,
      userId: input.userId,
      guestId: input.guestId,
      subject: input.subject,
      textVersion: input.textVersion ?? 'v1',
      now: opts.now ?? Date.now(),
    });
  },
};
