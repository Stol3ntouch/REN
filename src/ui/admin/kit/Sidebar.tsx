'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { findActiveEntry, navTarget, type AdminNavGroup, type AdminNavLeaf } from '../nav-core';
import { Icon } from './icons';
import { useIsNarrow, useShell } from './shell-context';
import { useFocusTrap } from './use-focus-trap';

/**
 * Боковая панель: логотип, группы и пункты (активный пункт и его группа подсвечены), раскрывающиеся подразделы,
 * «Свернуть меню». Меню приходит уже отфильтрованным по правам (`visibleNavGroups`).
 * На ширине < 1024 px — выдвижное меню: фокус заперт, Esc и оверлей закрывают.
 */
export function Sidebar({ groups }: { groups: readonly AdminNavGroup[] }) {
  const pathname = usePathname() ?? '';
  const { collapsed, drawerOpen, toggleCollapsed, closeDrawer } = useShell();
  const narrow = useIsNarrow();
  const ref = useRef<HTMLElement>(null);
  const modal = narrow && drawerOpen;
  const rail = collapsed && !narrow;

  useFocusTrap(ref, modal, { onEscape: closeDrawer });

  useEffect(() => {
    if (!modal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [modal]);

  const leaves = groups.flatMap((g) => g.items.flatMap((i): AdminNavLeaf[] => [i, ...(i.children ?? [])]));
  const active = findActiveEntry(pathname, leaves);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  return (
    <aside
      ref={ref}
      id="ak-sidebar"
      className="ak-sidebar"
      data-open={drawerOpen ? 'true' : 'false'}
      tabIndex={-1}
      {...(modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Меню админки' } : {})}
    >
      <div className="ak-sidebar__brand">
        <Link href="/admin" className="ak-logo" onClick={closeDrawer} aria-label="РемТехСад — панель управления">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ak-logo__full" src="/brand/logo-dark.png" alt="" width={180} height={28} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ak-logo__mark" src="/brand/mark-128.png" alt="" width={32} height={32} />
        </Link>
        <button type="button" className="ak-iconbtn ak-sidebar__close" onClick={closeDrawer} aria-label="Закрыть меню">
          <Icon name="x" size={20} />
        </button>
      </div>

      <nav className="ak-nav" aria-label="Разделы админки">
        {groups.map((g) => (
          <section key={g.key} className="ak-nav__group" aria-labelledby={g.label ? `ak-nav-${g.key}` : undefined}>
            {g.label ? (
              <h2 id={`ak-nav-${g.key}`} className="ak-nav__label">
                {g.label}
              </h2>
            ) : null}
            <ul className="ak-nav__list">
              {g.items.map((item) => {
                const children = item.children ?? [];
                const childActive = children.some((c) => c.key === active?.key);
                const isActive = active?.key === item.key;
                const expanded = overrides[item.key] ?? (isActive || childActive);
                return (
                  <li key={item.key} className="ak-nav__item">
                    <div className="ak-nav__row">
                      <Link
                        href={navTarget(item)}
                        className="ak-nav__link"
                        aria-current={isActive ? 'page' : undefined}
                        data-active={isActive || childActive ? 'true' : undefined}
                        title={rail ? item.label : undefined}
                        onClick={closeDrawer}
                      >
                        <Icon name={item.icon} size={20} />
                        <span className="ak-nav__text">{item.label}</span>
                      </Link>
                      {children.length > 0 ? (
                        <button
                          type="button"
                          className="ak-nav__toggle"
                          aria-expanded={expanded}
                          aria-controls={`ak-sub-${item.key}`}
                          aria-label={`Подразделы: ${item.label}`}
                          onClick={() => setOverrides((o) => ({ ...o, [item.key]: !expanded }))}
                        >
                          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
                        </button>
                      ) : null}
                    </div>
                    {children.length > 0 ? (
                      <ul id={`ak-sub-${item.key}`} className="ak-nav__sub" hidden={!expanded}>
                        {children.map((c) => (
                          <li key={c.key}>
                            <Link
                              href={navTarget(c)}
                              className="ak-nav__link ak-nav__link--sub"
                              aria-current={active?.key === c.key ? 'page' : undefined}
                              data-active={active?.key === c.key ? 'true' : undefined}
                              onClick={closeDrawer}
                            >
                              <span className="ak-nav__text">{c.label}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      <div className="ak-sidebar__footer">
        <button type="button" className="ak-collapse" onClick={toggleCollapsed} title={rail ? 'Развернуть меню' : undefined}>
          <Icon name={collapsed ? 'collapse-right' : 'collapse-left'} size={20} />
          <span className="ak-nav__text">{collapsed ? 'Развернуть меню' : 'Свернуть меню'}</span>
        </button>
      </div>
    </aside>
  );
}
