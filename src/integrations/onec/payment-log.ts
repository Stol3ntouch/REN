import { getDb, type Db } from '@/server/db/connection';
import { integrationRunsRepo } from '@/server/db/repositories/integration-runs';
import { setPaymentRunLogger, type PaymentRunEntry } from '../payment/service';

/** Логгер платёжных операций → integration_run (kind payment.create_payment | payment.webhook | payment.refund). */
export function makePaymentRunLogger(getDbFn: () => Db = getDb, nowFn: () => number = Date.now): (e: PaymentRunEntry) => void {
  return (e) => {
    try {
      const db = getDbFn();
      const now = nowFn();
      const id = integrationRunsRepo.start(db, { kind: `payment.${e.kind}`, actor: 'system', now });
      integrationRunsRepo.finish(db, id, {
        status: e.ok ? 'ok' : 'error',
        counts: e.orderId !== undefined ? { orderId: e.orderId } : {},
        errors: e.ok ? [] : [[e.code, e.message].filter(Boolean).join(': ') || 'ошибка'],
        now,
      });
    } catch {
      /* журнал не должен ломать оплату */
    }
  };
}

/** Подключает журнал к платёжному сервису. Вызвать один раз при старте (instrumentation) — вернёт функцию отключения. */
export function connectPaymentRunLog(getDbFn: () => Db = getDb): () => void {
  setPaymentRunLogger(makePaymentRunLogger(getDbFn));
  return () => setPaymentRunLogger(null);
}
