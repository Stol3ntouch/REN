import { describe, expect, it } from 'vitest';
import { makePaymentRunLogger } from '@/integrations/onec/payment-log';
import { integrationRunsRepo } from '@/server/db/repositories/integration-runs';
import { createTestDb } from '@/server/db/testing';

describe('журнал платёжных операций в integration_run', () => {
  it('успех и ошибка попадают отдельными запусками payment.*', () => {
    const db = createTestDb();
    const log = makePaymentRunLogger(() => db, () => 1_000);
    log({ kind: 'create_payment', ok: true, orderId: 7 });
    log({ kind: 'webhook', ok: false, orderId: 8, code: 'rejected', message: 'сумма не совпала' });
    const runs = integrationRunsRepo.list(db);
    expect(runs.map((r) => [r.kind, r.status])).toEqual([
      ['payment.webhook', 'error'],
      ['payment.create_payment', 'ok'],
    ]);
    expect(runs[0]!.errors).toEqual(['rejected: сумма не совпала']);
    expect(runs[0]!.counts).toEqual({ orderId: 8 });
    expect(runs[1]).toMatchObject({ actor: 'system', startedAt: 1_000, finishedAt: 1_000 });
  });

  it('сбой записи журнала не бросает исключение', () => {
    const log = makePaymentRunLogger(() => {
      throw new Error('db down');
    });
    expect(() => log({ kind: 'refund', ok: true })).not.toThrow();
  });
});
