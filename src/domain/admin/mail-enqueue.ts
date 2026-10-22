import { getDb, type Db } from '@/server/db/connection';

/**
 * Узкий порт «поставить письмо в очередь» (T09 реализует настоящую почту: MailPort + email_outbox).
 * Пока по умолчанию письмо пишется в таблицу-заглушку mail_stub_queue (ничего наружу не уходит).
 * T09 подменяет реализацию через setMailEnqueue() при старте — вызывающий код не меняется.
 *
 * События этого таска: 'auth.password_reset' { to, resetUrl, expiresAt }.
 */
export type MailEnqueue = (event: string, payload: Record<string, unknown>) => void;

type Opts = { db?: Db; now?: number };

let override: MailEnqueue | null = null;

/** T09: подключить настоящую очередь. null — вернуть заглушку. */
export function setMailEnqueue(impl: MailEnqueue | null): void {
  override = impl;
}

export function enqueueMail(event: string, payload: Record<string, unknown>, opts: Opts = {}): void {
  if (override) {
    override(event, payload);
    return;
  }
  (opts.db ?? getDb())
    .prepare('INSERT INTO mail_stub_queue (event, payload_json, created_at) VALUES (?, ?, ?)')
    .run(event, JSON.stringify(payload), opts.now ?? Date.now());
}
