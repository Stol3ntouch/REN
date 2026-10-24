'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon } from './icons';
import { nextSearchHref } from './url';

/**
 * Поиск по списку: через `debounceMs` после последнего ввода (или по Enter) пишет значение в адрес (?q=)
 * и сбрасывает страницу. Остальные параметры адреса сохраняются. Сервер читает `q` через parseListParams.
 */
export function SearchInput({ name = 'q', label = 'Поиск', placeholder = 'Поиск…', defaultValue = '', debounceMs = 350 }: { name?: string; label?: string; placeholder?: string; defaultValue?: string; debounceMs?: number }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const apply = (value: string): void => {
    if (timer.current) clearTimeout(timer.current);
    router.replace(nextSearchHref(pathname, window.location.search, name, value), { scroll: false });
  };

  return (
    <form
      className="ak-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        apply(input.current?.value ?? '');
      }}
    >
      <Icon name="search" size={18} />
      <input
        ref={input}
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        maxLength={200}
        onChange={(e) => {
          const value = e.target.value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => apply(value), debounceMs);
        }}
      />
    </form>
  );
}
