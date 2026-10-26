'use server';

import { mailSettingsAdmin } from '@/integrations/mail/settings-ops';
import { ValidationError } from '@/server/http/errors';
import { field, runAction, runStateAction } from '../../_lib/run-action';
import { checked, idField } from '../_forms';
import type { MailFormState } from './state';

const BACK = '/admin/settings/email';

const template = (form: FormData) => ({
  event: field(form, 'event'),
  audience: field(form, 'audience'),
  subject: typeof form.get('subject') === 'string' ? (form.get('subject') as string) : '',
  body: typeof form.get('body') === 'string' ? (form.get('body') as string) : '',
});

export async function saveTemplateAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => mailSettingsAdmin.saveTemplate(session, template(form)));
}

export async function resetTemplateAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => mailSettingsAdmin.resetTemplate(session, field(form, 'event'), field(form, 'audience')));
}

export async function toggleEventAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => mailSettingsAdmin.setEnabled(session, field(form, 'event'), field(form, 'audience'), checked(form, 'enabled')));
}

export async function retryMailAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => mailSettingsAdmin.retry(session, idField(form)));
}

/** Предпросмотр на тестовых данных, без сохранения. */
export async function previewTemplateAction(_prev: MailFormState, form: FormData): Promise<MailFormState> {
  const r = await runStateAction((session) => mailSettingsAdmin.preview(session, template(form)));
  if (!r.ok) return { status: 'error', message: r.error };
  return { status: 'preview', ...r.data };
}

/** Тестовая отправка: результат — ответ почтового сервиса, ошибка не выдаётся за успех. */
export async function sendTestAction(_prev: MailFormState, form: FormData): Promise<MailFormState> {
  const r = await runStateAction(async (session) => {
    const event = field(form, 'event');
    const res = await mailSettingsAdmin.sendTest(session, { to: field(form, 'to'), ...(event ? { event, audience: field(form, 'audience') } : {}) });
    if (!res.ok) throw new ValidationError(res.error);
    return res.message;
  });
  if (!r.ok) return { status: 'error', message: r.error };
  return { status: 'ok', message: r.data };
}
