import { setPaymentRefunder, setPaymentStarter } from '@/domain/ordering/payment-flow';
import { getDb } from '@/server/db/connection';
import { isProductionEnv } from './select';
import { disableTestPaymentInProduction, enableTestPaymentMethod, refundOrderPayment, startPaymentForOrder } from './service';

/**
 * Подключает платёжный провайдер к заказам: setPaymentStarter / setPaymentRefunder.
 * Вызывается лениво при первом обращении к оплате (domain/ordering/payment-flow) либо явно при старте.
 *  - production: тестовый метод принудительно выключается; стартер/возвратчик зарегистрированы, но без выбранного
 *    настоящего провайдера порт «не подключён» и платёж не создаётся;
 *  - вне production и PAYMENT_PROVIDER=test: метод «онлайн (ТЕСТ)» включается автоматически (иначе — вручную enableTestPaymentMethod).
 */
export function registerPaymentProvider(): void {
  setPaymentStarter((order) => startPaymentForOrder(order));
  setPaymentRefunder((order, ctx) => refundOrderPayment(order, ctx));
  try {
    const production = isProductionEnv();
    const db = getDb();
    if (production) disableTestPaymentInProduction(db, true);
    else if ((process.env.PAYMENT_PROVIDER ?? '').trim().toLowerCase() === 'test') enableTestPaymentMethod(db, { production: false });
  } catch {
    /* БД недоступна на старте: метод останется как есть, оплата не должна ронять приложение */
  }
}
