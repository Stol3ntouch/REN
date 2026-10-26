/** Состояние форм почты, которые отвечают на месте (без редиректа): предпросмотр и тестовая отправка. */
export type MailFormState =
  | { status: 'idle' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string }
  | { status: 'preview'; subject: string; body: string; problems: string[] };

export const MAIL_IDLE: MailFormState = { status: 'idle' };
