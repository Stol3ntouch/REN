import { trustProxyWarning } from '@/server/config';
import { setPopularitySource } from '@/domain/catalog/popularity';
import { NOT_COUNTED_STATUSES } from '@/domain/ordering/status';
import { connectMail } from '@/integrations/mail';
import { connectPaymentRunLog } from '@/integrations/onec/payment-log';
import { registerPaymentProvider } from '@/integrations/payment/register';
import { reconcileStaleRefunds } from '@/integrations/payment/service';

/** SQL популярности: единицы товара в заказах вне NOT_COUNTED_STATUSES (константы из кода, не ввод пользователя). */
export function popularitySql(): string {
  const skipped = NOT_COUNTED_STATUSES.map((s) => `'${s}'`).join(', ');
  return `SELECT oi.product_id AS id, SUM(oi.qty) AS units FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id IS NOT NULL AND o.status NOT IN (${skipped}) GROUP BY oi.product_id`;
}

/**
 * Подключения, которые нужны работающему приложению (вызывает src/instrumentation.ts в runtime nodejs):
 * журнал платежей → integration_run, почта (очередь + фоновый воркер), популярность товаров, платёжный провайдер, подбор зависших возвратов.
 * Повторный вызов безопасен (HMR). Во время `next build` ничего не подключается: сборка не должна открывать БД и слать письма.
 */
export function connectApp(o: { startMailWorker?: boolean } = {}): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const proxyWarning = trustProxyWarning();
  if (proxyWarning) console.warn(proxyWarning);
  connectPaymentRunLog();
  setPopularitySource(() => popularitySql());
  registerPaymentProvider();
  connectMail({ startWorker: o.startMailWorker });
  // Возвраты, зависшие после падения процесса (refund_pending), доводятся до конца; сбой старту не мешает.
  void reconcileStaleRefunds().catch(() => {});
}
