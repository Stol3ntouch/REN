'use server';

import { ValidationError } from '@/server/http/errors';
import { integrationsOps, type IntegrationAction } from '../_lib/integrations-ops';
import { field, runAction } from '../_lib/run-action';

/** Ручной запуск обмена 1С. Право integrations.run проверяет integrationsOps.run. Результат виден в журнале запусков. */
export async function runIntegrationAction(form: FormData): Promise<never> {
  return runAction('/admin/integrations', async (session) => {
    await integrationsOps.run(session, field(form, 'action') as IntegrationAction, { orderNumber: field(form, 'orderNumber') || undefined });
  });
}

/** Безопасный повтор прошлого запуска. */
export async function retryRunAction(form: FormData): Promise<never> {
  return runAction('/admin/integrations', async (session) => {
    const id = Number(field(form, 'runId'));
    if (!Number.isInteger(id) || id < 1) throw new ValidationError('Запуск не найден');
    await integrationsOps.retry(session, id);
  });
}
