import type { RequestKind, RequestStatus } from '@/server/db/repositories/requests';

/** Каналы обращений (всё, кроме ремонта) и их названия. */
export const INQUIRY_CHANNELS = ['contact', 'question', 'callback'] as const;
export type InquiryChannel = (typeof INQUIRY_CHANNELS)[number];
export const CHANNEL_LABELS: Readonly<Record<RequestKind, string>> = {
  contact: 'Обратная связь',
  question: 'Вопрос о товаре',
  callback: 'Звонок',
  repair: 'Ремонт',
};

/** Статусы обращений: новое, в работе, ожидает ответа, закрыто. */
export const INQUIRY_STATUSES = ['new', 'in_work', 'waiting', 'closed'] as const satisfies readonly RequestStatus[];
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const INQUIRY_LABELS: Readonly<Record<InquiryStatus, string>> = { new: 'Новое', in_work: 'В работе', waiting: 'Ожидает ответа', closed: 'Закрыто' };

/** Статусы заявок на ремонт. */
export const REPAIR_STATUSES = ['new', 'diagnostics', 'awaiting_approval', 'in_repair', 'awaiting_parts', 'ready', 'completed', 'cancelled'] as const satisfies readonly RequestStatus[];
export type RepairStatus = (typeof REPAIR_STATUSES)[number];
export const REPAIR_LABELS: Readonly<Record<RepairStatus, string>> = {
  new: 'Новая',
  diagnostics: 'Диагностика',
  awaiting_approval: 'Ожидает согласования',
  in_repair: 'В ремонте',
  awaiting_parts: 'Ожидает запчасти',
  ready: 'Готова к выдаче',
  completed: 'Завершена',
  cancelled: 'Отменена',
};

/** Допустимые переходы ремонта (единая таблица). Завершённая и отменённая заявки закрыты. */
export const REPAIR_TRANSITIONS: Readonly<Record<RepairStatus, readonly RepairStatus[]>> = {
  new: ['diagnostics', 'cancelled'],
  diagnostics: ['awaiting_approval', 'in_repair', 'awaiting_parts', 'cancelled'],
  awaiting_approval: ['diagnostics', 'in_repair', 'cancelled'],
  in_repair: ['awaiting_parts', 'ready', 'cancelled'],
  awaiting_parts: ['in_repair', 'cancelled'],
  ready: ['in_repair', 'completed'],
  completed: [],
  cancelled: [],
};

export const isRepairStatus = (v: unknown): v is RepairStatus => (REPAIR_STATUSES as readonly unknown[]).includes(v);
export const isInquiryStatus = (v: unknown): v is InquiryStatus => (INQUIRY_STATUSES as readonly unknown[]).includes(v);
export const isInquiryChannel = (v: unknown): v is InquiryChannel => (INQUIRY_CHANNELS as readonly unknown[]).includes(v);

export function canRepairTransition(from: RepairStatus, to: RepairStatus): boolean {
  return REPAIR_TRANSITIONS[from].includes(to);
}

/** Обращение переходит между любыми своими статусами (в том числе открывается заново), кроме «в себя». */
export function canInquiryTransition(from: InquiryStatus, to: InquiryStatus): boolean {
  return from !== to;
}

export const REPAIR_PHOTO_LIMIT = 5;

/** Название статуса для показа: подходит и обращению, и ремонту. */
export function statusLabel(kind: RequestKind, status: RequestStatus): string {
  if (kind === 'repair') return isRepairStatus(status) ? REPAIR_LABELS[status] : status;
  return isInquiryStatus(status) ? INQUIRY_LABELS[status] : status;
}
