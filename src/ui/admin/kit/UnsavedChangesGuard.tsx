'use client';

import { useEffect, useRef } from 'react';
import { attachUnsavedGuard, UNSAVED_MESSAGE } from './unsaved-guard';

/**
 * Защита от случайной потери данных. Укажите `formId` — форма считается изменённой после первого ввода, а отправка
 * и сброс (кнопка «Отмена») снимают отметку. Либо управляйте сами через `dirty`.
 * При закрытии вкладки показывается системное предупреждение, при клике по внутренней ссылке — подтверждение.
 */
export function UnsavedChangesGuard({ formId, dirty, message = UNSAVED_MESSAGE }: { formId?: string; dirty?: boolean; message?: string }) {
  const tracked = useRef(false);
  const forced = useRef<boolean | undefined>(dirty);
  useEffect(() => {
    forced.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const isDirty = (): boolean => forced.current ?? tracked.current;
    const inForm = (e: Event): boolean => {
      const form = (e.target as Element | null)?.closest?.('form');
      return !!form && (!formId || form.id === formId);
    };
    const onEdit = (e: Event): void => {
      if (inForm(e)) tracked.current = true;
    };
    const onClear = (e: Event): void => {
      if (inForm(e)) tracked.current = false;
    };
    document.addEventListener('input', onEdit);
    document.addEventListener('change', onEdit);
    document.addEventListener('submit', onClear);
    document.addEventListener('reset', onClear);
    const detach = attachUnsavedGuard({ win: window, doc: document }, isDirty, message);
    return () => {
      document.removeEventListener('input', onEdit);
      document.removeEventListener('change', onEdit);
      document.removeEventListener('submit', onClear);
      document.removeEventListener('reset', onClear);
      detach();
    };
  }, [formId, message]);

  return null;
}
