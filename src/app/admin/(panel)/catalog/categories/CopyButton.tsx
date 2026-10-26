'use client';

import { useState } from 'react';
import { Icon, useToast } from '@/ui/admin/kit';

/** Копирует адрес категории в буфер обмена; без доступа к буферу — сообщает об этом. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cat-copy"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast.success('Адрес скопирован');
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error('Не удалось скопировать. Выделите адрес вручную.');
        }
      }}
    >
      <Icon name={done ? 'check' : 'clipboard'} size={16} />
    </button>
  );
}
