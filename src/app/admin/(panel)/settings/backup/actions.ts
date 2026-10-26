'use server';

import { backupAdmin } from '@/domain/admin/backup';
import { ConflictError } from '@/server/http/errors';
import { field, runAction, runStateAction } from '../../_lib/run-action';
import { idField } from '../_forms';

const BACK = '/admin/settings/backup';

export type LinkState = { status: 'idle' } | { status: 'link'; path: string; expiresAt: number } | { status: 'error'; message: string };

/** Создание копии: задача ставится и выполняется в фоне, страница показывает статус и прогресс. */
export async function startBackupAction(): Promise<never> {
  return runAction(BACK, (session) => {
    backupAdmin.start(session);
  });
}

export async function verifyBackupAction(form: FormData): Promise<never> {
  return runAction(BACK, async (session) => {
    const r = await backupAdmin.verify(session, idField(form));
    if (!r.ok) throw new ConflictError(`Проверка не пройдена: ${r.message}`);
  });
}

/** Одноразовая ссылка показывается один раз в ответе формы, в адрес страницы не попадает. */
export async function downloadLinkAction(_prev: LinkState, form: FormData): Promise<LinkState> {
  const r = await runStateAction((session) => backupAdmin.downloadLink(session, idField(form)));
  if (!r.ok) return { status: 'error', message: r.error };
  return { status: 'link', path: r.data.path, expiresAt: r.data.expiresAt };
}

export async function requestRestoreAction(form: FormData): Promise<never> {
  return runAction(BACK, async (session) => {
    const password = typeof form.get('password') === 'string' ? (form.get('password') as string) : '';
    await backupAdmin.requestRestore(session, { id: idField(form), confirmWord: field(form, 'confirmWord'), password });
  });
}

export async function cancelRestoreAction(): Promise<never> {
  return runAction(BACK, (session) => {
    backupAdmin.cancelRestore(session);
  });
}
