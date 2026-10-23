import { getConfig } from '@/server/config';
import { MailNotConfiguredError, type Mail, type MailPort, type SmtpConfig } from './types';

/** Заглушка: ничего наружу не отправляет, честно говорит об этом в status(). */
export function createStubMailPort(): MailPort {
  return {
    name: 'stub',
    status: () => ({ connected: false, mode: 'stub', note: 'SMTP не настроен: письма копятся в журнале (email_outbox) и не отправляются' }),
    async send() {
      throw new MailNotConfiguredError();
    },
  };
}

/** SMTP через nodemailer. Таймауты обязательны; пароль нигде не логируется. */
export function createSmtpMailPort(cfg: SmtpConfig): MailPort {
  let transporter: import('nodemailer').Transporter | null = null;
  const get = async () => {
    if (!transporter) {
      const nodemailer = await import('nodemailer');
      transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? '' } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
    return transporter;
  };
  return {
    name: 'smtp',
    status: () => ({ connected: true, mode: 'live', note: 'SMTP настроен (соединение проверяется при отправке)' }),
    async send(m: Mail) {
      const t = await get();
      await t.sendMail({ from: cfg.from, to: m.to.join(', '), subject: m.subject, text: m.text });
    },
  };
}

type MailEnv = { host?: string; port?: number; user?: string; password?: string; from?: string };

/** Порт по настройкам: нужны хотя бы host и from, иначе заглушка. */
export function selectMailPort(mail: MailEnv = getConfig().mail): MailPort {
  if (mail.host && mail.from) {
    return createSmtpMailPort({ host: mail.host, port: mail.port ?? 587, user: mail.user, password: mail.password, from: mail.from });
  }
  return createStubMailPort();
}

/** Значения секретов из настроек — чтобы вычищать их из текстов ошибок. */
export function mailSecrets(mail: MailEnv = getConfig().mail): string[] {
  return [mail.password, mail.user, mail.host].filter((v): v is string => typeof v === 'string' && v.length >= 3);
}
