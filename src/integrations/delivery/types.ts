import type { PortStatus } from '../types';

export type DeliveryMethod = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  kind: 'pickup' | 'manual';
  /** null — стоимость рассчитает менеджер; тарифов не выдумываем. */
  priceKopecks: number | null;
  requiresAddress: boolean;
};

export type DeliveryQuote = { priceKopecks: number | null; manual: boolean };

export interface DeliveryPort {
  status(): PortStatus;
  listMethods(): Promise<DeliveryMethod[]>;
  /** priceKopecks=null и manual=true — «по согласованию с менеджером». */
  quote(cart: { subtotalKopecks: number }, address: { text?: string } | null, opts?: { methodCode?: string }): Promise<DeliveryQuote>;
}
