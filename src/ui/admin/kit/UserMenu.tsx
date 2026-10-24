'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icons';

/**
 * Меню профиля в верхней панели: аватар с инициалом, имя и роль; пункты «Профиль» и «Выйти».
 * Закрывается по Esc, клику снаружи и уходу фокуса. `logout` — server action выхода (форма POST).
 */
export function UserMenu({ initial, name, roleLabel, logout }: { initial: string; name: string; roleLabel: string; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent): void {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      className="ak-user"
      ref={root}
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button ref={button} type="button" className="ak-user__button" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        <span className="ak-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="ak-user__text">
          <span className="ak-user__name">{name}</span>
          <span className="ak-user__role">{roleLabel}</span>
        </span>
        <Icon name="chevron-down" size={16} />
        <span className="visually-hidden">Меню профиля</span>
      </button>
      {open ? (
        <div id={menuId} className="ak-menu" role="menu" aria-label="Профиль">
          <Link href="/admin/profile" role="menuitem" className="ak-menu__item" onClick={() => setOpen(false)}>
            <Icon name="user" size={18} />
            Профиль
          </Link>
          <form action={logout}>
            <button type="submit" role="menuitem" className="ak-menu__item">
              <Icon name="log-out" size={18} />
              Выйти
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
