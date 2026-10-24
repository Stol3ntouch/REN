/** Состояния форм сотрудников (useActionState). Отдельный файл: модуль 'use server' может экспортировать только функции. */
export type StaffLinkInfo = { url: string; expiresAt: number; mailed: boolean };

export type StaffFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fields?: Record<string, string[]> }
  /** Приглашение создано: ссылка показывается один раз. */
  | { status: 'invite'; login: string; link: StaffLinkInfo }
  /** Ссылка сброса выдана: показывается один раз. */
  | { status: 'reset'; link: StaffLinkInfo };

export const STAFF_IDLE: StaffFormState = { status: 'idle' };
