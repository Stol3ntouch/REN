import type { Db } from '@/server/db/connection';
import { methodsRepo } from '@/server/db/repositories/methods';
import type { DeliveryPort } from './types';

/**
 * Ручная доставка: способы берутся из delivery_methods, стоимость «по согласованию» рассчитывает менеджер.
 * Никаких тарифов и сроков здесь нет; самовывоз стоит ровно то, что записано в таблице способов.
 */
export function createManualDelivery(getDb: () => Db): DeliveryPort {
  return {
    status: () => ({
      connected: false,
      mode: 'stub',
      note: 'Служба доставки не подключена: стоимость и срок согласует менеджер.',
    }),
    async listMethods() {
      return methodsRepo.listDelivery(getDb(), { enabledOnly: true }).map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        description: m.description,
        kind: m.kind,
        priceKopecks: m.priceKopecks,
        requiresAddress: m.requiresAddress,
      }));
    },
    async quote(_cart, _address, opts = {}) {
      if (opts.methodCode) {
        const known = methodsRepo.listDelivery(getDb(), { enabledOnly: true }).find((m) => m.code === opts.methodCode);
        if (known && known.priceKopecks !== null) return { priceKopecks: known.priceKopecks, manual: false };
      }
      return { priceKopecks: null, manual: true };
    },
  };
}
