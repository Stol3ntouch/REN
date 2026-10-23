import type { PortStatus } from '../types';

/** Заказ сайта для выгрузки в 1С. Неизменяемый снимок: статус не входит, поэтому повторный экспорт даёт тот же файл. */
export type OrderExport = {
  /** Внешний id заказа на сайте — номер RTS-000123; ключ идемпотентности. */
  externalId: string;
  number: string;
  createdAt: number;
  contact: { name: string; email: string; phone: string; address: string | null; comment: string | null };
  delivery: { name: string; kopecks: number | null };
  payment: { name: string };
  items: { sku: string | null; name: string; qty: number; unitKopecks: number; lineKopecks: number }[];
  subtotalKopecks: number;
  discountKopecks: number;
  totalKopecks: number;
};

/** Пакет каталога из 1С: YML-файл из inbox (null — файла нет). */
export type CatalogBatch = { fileName: string | null; xml: string | null };

/** Запись из файла статусов 1С; допустимость статуса и перехода проверяет сервис. */
export type StatusUpdate = { orderNumber: string; status: string; updatedAt: number };

export type PushResult = { externalId: string; /** false — заказ уже был выгружен. */ created: boolean; /** Заказ уже выгружен с ДРУГИМ содержимым: файл не перезаписан. */ conflict?: boolean };

export interface OneCPort {
  readonly name: string;
  status(): PortStatus;
  pullCatalog(): Promise<CatalogBatch>;
  pushOrder(order: OrderExport): Promise<PushResult>;
  pullOrderStatuses(since: Date): Promise<StatusUpdate[]>;
}

export class OnecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnecError';
  }
}
