import type { Db } from '@/server/db/connection';
import { adminFlagsRepo, FLAG_NOTIFY_RECIPIENTS } from '@/server/db/repositories/staff-admin';
import type { Mail, MailPort } from '@/integrations/mail/types';

export const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
export const MIN = 60_000;

/** Живой поддельный порт: запоминает письма, сбои управляются счётчиком. */
export function fakePort(opts: { failTimes?: number; error?: string } = {}) {
  const sent: Mail[] = [];
  let calls = 0;
  const port: MailPort = {
    name: 'fake',
    status: () => ({ connected: true, mode: 'live' }),
    async send(m) {
      calls += 1;
      if (calls <= (opts.failTimes ?? 0)) throw new Error(opts.error ?? 'connection refused');
      sent.push(m);
    },
  };
  return { port, sent, calls: () => calls };
}

export function setRecipients(db: Db, emails: string[]): void {
  adminFlagsRepo.set(db, FLAG_NOTIFY_RECIPIENTS, JSON.stringify(emails), T0, 'test');
}

export const orderCreated = {
  to: 'anna@example.com',
  name: 'Анна',
  orderNumber: 'RTS-000123',
  status: 'new',
  subtotalKopecks: 100000,
  discountKopecks: 0,
  deliveryName: 'Самовывоз',
  deliveryPending: false,
  deliveryKopecks: 0,
  paymentName: 'При получении',
  totalKopecks: 100000,
  items: [{ name: 'Триммер', sku: 'T-1', qty: 1, unitKopecks: 100000, lineKopecks: 100000 }],
  orderUrl: 'https://shop.test/order/RTS-000123?t=abc',
};

export const resetPayload = { to: 'anna@example.com', resetUrl: 'https://shop.test/account/reset/SECRET-TOKEN-123', expiresAt: T0 + 3_600_000 };

export const outboxRows = (db: Db) =>
  db.prepare('SELECT id, event, audience, to_addr, subject, status, attempts, next_attempt_at, last_error, payload_json FROM email_outbox ORDER BY id').all() as {
    id: number;
    event: string;
    audience: string;
    to_addr: string | null;
    subject: string;
    status: string;
    attempts: number;
    next_attempt_at: number;
    last_error: string | null;
    payload_json: string;
  }[];
