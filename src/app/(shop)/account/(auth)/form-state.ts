/** Состояние формы для useActionState: тексты на русском, поля — для подсказок у инпутов. */
export type FormState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fields?: Record<string, string[]>;
};

export const IDLE: FormState = { status: 'idle' };
