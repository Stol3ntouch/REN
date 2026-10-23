/** Состояния форм кабинета (общий FormState — из раздела входа). */
export type ReorderState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
  /** Пропущенные позиции и причина — показываем покупателю, ничего не скрываем. */
  skipped?: Array<{ name: string; reason: string }>;
};

export const REORDER_IDLE: ReorderState = { status: 'idle' };
