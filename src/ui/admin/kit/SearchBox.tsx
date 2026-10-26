'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import '../c10.css';
import { Icon } from './icons';

type Item = { title: string; subtitle: string | null; href: string };
type Group = { key: string; label: string; items: Item[] };
type Reply = { query: string; groups: Group[]; total: number; partial: boolean };

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

const isTyping = (el: EventTarget | null): boolean => {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) || e.isContentEditable;
};

/**
 * Глобальный поиск верхней панели (товары, категории, заказы, клиенты, обращения). Подсказки приходят из
 * GET /admin/api/search с задержкой 250 мс; горячая клавиша «/» ставит курсор в поле; ↑ ↓ Enter Esc — с клавиатуры.
 * Что именно найдётся, решают права сотрудника на сервере: интерфейс ничего не фильтрует сам.
 */
export function SearchBox({ placeholder = 'Поиск товаров, заказов, клиентов…  ( / )' }: { placeholder?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLFormElement>(null);
  const listId = useId();
  const [q, setQ] = useState('');
  const [reply, setReply] = useState<Reply | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'limited'>('idle');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const flat = reply ? reply.groups.flatMap((g) => g.items) : [];
  const query = q.replace(/\s+/g, ' ').trim();
  const short = [...query].length < MIN_CHARS;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  useEffect(() => {
    if (short) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setState('loading');
      fetch(`/admin/api/search?q=${encodeURIComponent(query)}`, { signal: ctl.signal, headers: { accept: 'application/json' } })
        .then(async (r) => {
          if (r.status === 429) {
            setState('limited');
            return;
          }
          if (!r.ok) throw new Error(String(r.status));
          setReply((await r.json()) as Reply);
          setActive(-1);
          setState('idle');
        })
        .catch((e: unknown) => {
          if ((e as { name?: string }).name !== 'AbortError') setState('error');
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query, short]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown' && flat.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % flat.length);
    } else if (e.key === 'ArrowUp' && flat.length > 0) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? flat.length - 1 : a - 1));
    }
  };

  const showPanel = open && !short;
  let index = -1;

  return (
    <form
      ref={boxRef}
      className="ak-searchbox"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const target = flat[active >= 0 ? active : 0];
        if (target) go(target.href);
      }}
    >
      <label htmlFor="ak-global-search" className="visually-hidden">
        Поиск по админке
      </label>
      <input
        ref={inputRef}
        id="ak-global-search"
        name="q"
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={100}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="ak-searchbox__submit" aria-label="Найти">
        <Icon name="search" size={18} />
      </button>
      {showPanel ? (
        <div className="ak-searchbox__panel" id={listId} role="listbox" aria-label="Результаты поиска">
          {state === 'loading' && !reply ? <p className="ak-searchbox__note">Ищем…</p> : null}
          {state === 'error' ? <p className="ak-searchbox__note">Не удалось выполнить поиск. Попробуйте ещё раз.</p> : null}
          {state === 'limited' ? <p className="ak-searchbox__note">Слишком много запросов. Подождите минуту.</p> : null}
          {reply && reply.query === query && reply.total === 0 && state === 'idle' ? <p className="ak-searchbox__note">Ничего не найдено.</p> : null}
          {reply?.groups.map((g) => (
            <div key={g.key} role="group" aria-label={g.label}>
              <p className="ak-searchbox__group">{g.label}</p>
              {g.items.map((it) => {
                index += 1;
                const i = index;
                return (
                  <a
                    key={it.href}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? 'ak-searchbox__item is-active' : 'ak-searchbox__item'}
                    href={it.href}
                    onClick={(e) => {
                      e.preventDefault();
                      go(it.href);
                    }}
                  >
                    <span>{it.title}</span>
                    {it.subtitle ? <small>{it.subtitle}</small> : null}
                  </a>
                );
              })}
            </div>
          ))}
          {reply?.partial ? <p className="ak-searchbox__note">Показаны не все группы: уточните запрос.</p> : null}
        </div>
      ) : null}
    </form>
  );
}
