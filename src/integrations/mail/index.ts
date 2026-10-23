export type { Mail, MailPort } from './types';
export { MailNotConfiguredError } from './types';
export { createSmtpMailPort, createStubMailPort, selectMailPort } from './ports';
export { enqueueMailEvent, resolveRecipients } from './outbox';
export { MAX_ATTEMPTS, processOutbox, sanitizeMailError } from './worker';
export { connectMail, runMailWorkerOnce, stopMailWorker } from './connect';

import { selectMailPort } from './ports';
import type { MailPort } from './types';

/** Почтовый порт по env: SMTP при заданных MAIL_HOST и MAIL_FROM, иначе заглушка (status().connected=false). */
export function getMailPort(): MailPort {
  return selectMailPort();
}
