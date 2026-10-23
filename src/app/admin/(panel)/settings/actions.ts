'use server';

import { field, runAction } from '../_lib/run-action';
import { settingsOps } from '../_lib/settings-ops';

export async function setManualEditAction(form: FormData): Promise<never> {
  return runAction('/admin/settings', (session) => {
    settingsOps.setManualEdit(session, form.get('enabled') === 'on');
  });
}

export async function setRecipientsAction(form: FormData): Promise<never> {
  return runAction('/admin/settings', (session) => {
    settingsOps.setRecipients(session, field(form, 'recipients'));
  });
}
