import type { PortStatus } from '../types';

/** Письмо к отправке. to — уже готовые адреса. Тело — простой текст. */
export type Mail = { to: string[]; subject: string; text: string };

export interface MailPort {
  name: string;
  status(): PortStatus;
  send(m: Mail): Promise<void>;
}

/** Реальная отправка невозможна: SMTP не настроен. Письмо остаётся в очереди (попытка не тратится). */
export class MailNotConfiguredError extends Error {
  constructor() {
    super('SMTP не настроен');
    this.name = 'MailNotConfiguredError';
  }
}

export type SmtpConfig = { host: string; port: number; user?: string; password?: string; from: string };
