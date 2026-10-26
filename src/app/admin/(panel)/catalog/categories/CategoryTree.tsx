'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Icon, useToast } from '@/ui/admin/kit';
import type { CategorySearchHit, TreeNode } from '../../_lib/category-tree-ops';
import { bulkCategoriesAction, placeCategoryAction, selectCategoryIdsAction, setCategoryVisibleAction, stepCategoryAction } from './actions';

export type ParentChoice = { id: number; label: string };
type Levels = Record<string, TreeNode[]>;
type DropZone = 'before' | 'inside' | 'after';

const ROOT = 'root';
const STORAGE_KEY = 'rts-admin-category-tree';
const key = (parent: number | null): string => (parent === null ? ROOT : String(parent));

async function loadLevel(parent: number | null): Promise<{ nodes: TreeNode[]; total: number }> {
  const res = await fetch(`/admin/api/categories/children?parent=${parent === null ? ROOT : parent}`, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error('load');
  return (await res.json()) as { nodes: TreeNode[]; total: number };
}

function readExpanded(): number[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}
function writeExpanded(ids: Iterable<number>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(0, 300)));
  } catch {
    /* хранилище недоступно — состояние раскрытия просто не запоминается */
  }
}

/**
 * Дерево категорий: уровни подгружаются при раскрытии, поиск по названию с путём, глаз видимости, перетаскивание
 * (и «выше/ниже» с клавиатуры), «+» для дочерней, флажки выбора и панель массовых действий (скрыть / показать / перенести).
 * Состояние раскрытия сохраняется в браузере. Права на запись проверяет сервер в каждом действии.
 */
export function CategoryTree({
  initialLevels,
  total,
  selectedId,
  tab,
  canWrite,
  parentChoices,
}: {
  initialLevels: Levels;
  total: number;
  selectedId: number | null;
  tab: string;
  canWrite: boolean;
  parentChoices: ParentChoice[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [levels, setLevels] = useState<Levels>(initialLevels);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(Object.keys(initialLevels).filter((k) => k !== ROOT).map(Number)));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CategorySearchHit[] | null>(null);
  const [drag, setDrag] = useState<{ id: number; over: number | null; zone: DropZone } | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const loading = useRef(new Set<string>());
  const levelsRef = useRef(levels);
  useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);

  const fetchLevel = useCallback(
    async (parent: number | null): Promise<void> => {
      const k = key(parent);
      if (loading.current.has(k)) return;
      loading.current.add(k);
      try {
        const r = await loadLevel(parent);
        setLevels((cur) => ({ ...cur, [k]: r.nodes }));
      } catch {
        toast.error('Не удалось загрузить категории. Обновите страницу.');
      } finally {
        loading.current.delete(k);
      }
    },
    [toast],
  );

  /** Перечитать все уже загруженные уровни (после переноса, скрытия, массового действия). */
  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all(Object.keys(levelsRef.current).map((k) => fetchLevel(k === ROOT ? null : Number(k))));
  }, [fetchLevel]);

  // раскрытые ранее ветки (из браузера) догружаются один раз после показа
  useEffect(() => {
    const saved = readExpanded();
    if (saved.length === 0) return;
    // раскрытие из браузера применяем после монтирования (до этого сервер и клиент рисуют одно и то же)
    queueMicrotask(() => setExpanded((cur) => new Set([...cur, ...saved])));
    for (const id of saved) if (!(String(id) in levelsRef.current)) void fetchLevel(id);
  }, [fetchLevel]);

  // поиск с задержкой
  useEffect(() => {
    const q = query.trim();
    if (q === '') return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/api/categories/children?q=${encodeURIComponent(q)}`, { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) throw new Error('search');
        setHits(((await res.json()) as { hits: CategorySearchHit[] }).hits);
      } catch {
        setHits([]);
        toast.error('Поиск не удался. Попробуйте ещё раз.');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, toast]);

  function toggleExpand(id: number): void {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      if (!(String(id) in levels)) void fetchLevel(id);
    }
    setExpanded(next);
    writeExpanded(next);
  }

  const parentOfNode = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const list of Object.values(levels)) for (const n of list) m.set(n.id, n.parentId);
    return m;
  }, [levels]);

  async function toggleVisible(node: TreeNode): Promise<void> {
    const visible = node.hidden; // сейчас скрыта — покажем
    const patch = (hidden: boolean) => setLevels((cur) => ({ ...cur, [key(node.parentId)]: (cur[key(node.parentId)] ?? []).map((n) => (n.id === node.id ? { ...n, hidden } : n)) }));
    patch(!visible);
    const r = await setCategoryVisibleAction(node.id, visible).catch(() => null);
    if (!r || !r.ok) {
      patch(node.hidden); // возврат к серверному значению
      toast.error(r && !r.ok ? r.error : 'Не удалось сохранить видимость. Попробуйте ещё раз.');
      return;
    }
    toast.success(visible ? 'Категория показана на сайте' : r.data.cascaded > 0 ? `Категория скрыта вместе с подкатегориями (${r.data.cascaded}). Товары не удалены` : 'Категория скрыта. Товары не удалены');
    await refreshAll();
    router.refresh();
  }

  async function place(id: number, parentId: number | null, beforeId: number | null): Promise<void> {
    setBusy(true);
    const r = await placeCategoryAction(id, parentId, beforeId).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) {
      toast.error(r && !r.ok ? r.error : 'Не удалось перенести категорию.');
      return;
    }
    if (parentId !== null && !expanded.has(parentId)) {
      const next = new Set(expanded).add(parentId);
      setExpanded(next);
      writeExpanded(next);
      void fetchLevel(parentId);
    }
    if (r.data.changed) toast.success('Порядок сохранён');
    await refreshAll();
    router.refresh();
  }

  async function step(id: number, dir: 'up' | 'down'): Promise<void> {
    setBusy(true);
    const r = await stepCategoryAction(id, dir).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return void toast.error(r && !r.ok ? r.error : 'Не удалось изменить порядок.');
    await refreshAll();
    router.refresh();
  }

  function onDrop(e: DragEvent, target: TreeNode): void {
    e.preventDefault();
    const d = drag;
    setDrag(null);
    if (!d || d.id === target.id) return;
    if (d.zone === 'inside') return void place(d.id, target.id, null);
    const siblings = levels[key(target.parentId)] ?? [];
    const i = siblings.findIndex((n) => n.id === target.id);
    const before = d.zone === 'before' ? target.id : (siblings[i + 1]?.id ?? null);
    void place(d.id, target.parentId, before === d.id ? (siblings[i + 2]?.id ?? null) : before);
  }

  function zoneOf(e: DragEvent): DropZone {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
  }

  // --- выбор и массовые действия
  function toggleSelect(id: number): void {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function selectScope(scope: { level: number | null } | { subtree: number }): Promise<void> {
    const r = await selectCategoryIdsAction(scope).catch(() => null);
    if (!r || !r.ok) return void toast.error(r && !r.ok ? r.error : 'Не удалось выбрать категории.');
    setSelected((cur) => new Set([...cur, ...r.data]));
  }

  async function runBulk(action: { type: 'hide' } | { type: 'show' } | { type: 'move'; parentId: number | null }): Promise<void> {
    if (selected.size === 0) return;
    setBusy(true);
    const r = await bulkCategoriesAction([...selected], action).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return void toast.error(r && !r.ok ? r.error : 'Не удалось выполнить действие.');
    const { changed, skipped, cascaded, skippedItems } = r.data;
    const text = `Изменено: ${changed}, пропущено: ${skipped}${cascaded > 0 ? `, вложенных затронуто: ${cascaded}` : ''}`;
    if (changed === 0) toast.info(`${text}${skippedItems[0] ? `. ${skippedItems[0].reason}` : ''}`);
    else toast.success(text);
    setSelected(new Set());
    await refreshAll();
    router.refresh();
  }

  const href = (id: number) => `/admin/catalog/categories?id=${id}${tab ? `&tab=${tab}` : ''}`;
  const activeParent = selectedId === null ? null : (parentOfNode.get(selectedId) ?? null);

  function renderLevel(parent: number | null, depth: number, ancestorOff: boolean): React.ReactNode {
    const list = levels[key(parent)];
    if (!list) return <li className="cat-tree__loading" role="status">Загрузка…</li>;
    return list.map((n, index) => {
      const open = expanded.has(n.id);
      const off = ancestorOff || n.effectiveHidden || n.hidden || !n.active;
      const isOver = drag?.over === n.id;
      return (
        <li key={n.id} className="cat-tree__item">
          <div
            className={`cat-tree__row${n.id === selectedId ? ' is-active' : ''}${off ? ' is-off' : ''}${isOver ? ` is-drop-${drag?.zone}` : ''}`}
            draggable={canWrite}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(n.id));
              setDrag({ id: n.id, over: null, zone: 'inside' });
            }}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => {
              if (!drag || drag.id === n.id) return;
              e.preventDefault();
              const zone = zoneOf(e);
              if (drag.over !== n.id || drag.zone !== zone) setDrag({ ...drag, over: n.id, zone });
            }}
            onDrop={(e) => onDrop(e, n)}
          >
            {canWrite ? (
              <label className="cat-tree__check">
                <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggleSelect(n.id)} aria-label={`Выбрать «${n.name}»`} />
              </label>
            ) : null}
            {n.hasChildren ? (
              <button type="button" className="cat-tree__expand" aria-expanded={open} aria-label={`${open ? 'Свернуть' : 'Развернуть'} «${n.name}»`} onClick={() => toggleExpand(n.id)}>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
              </button>
            ) : (
              <span className="cat-tree__expand cat-tree__expand--none" aria-hidden="true" />
            )}
            <Icon name="folder" size={16} className="cat-tree__icon" />
            <Link href={href(n.id)} className="cat-tree__name" aria-current={n.id === selectedId ? 'true' : undefined} prefetch={false}>
              {n.name}
              {!n.active ? <span className="cat-tree__badge">неактивна</span> : null}
            </Link>
            <span className="cat-tree__count" title="Опубликованные видимые товары категории и подкатегорий">
              {n.productCount}
            </span>
            {canWrite ? (
              <span className="cat-tree__tools">
                <button type="button" className="cat-tree__tool" onClick={() => void step(n.id, 'up')} disabled={busy || index === 0} aria-label={`Выше: «${n.name}»`}>
                  <Icon name="arrow-up" size={14} />
                </button>
                <button type="button" className="cat-tree__tool" onClick={() => void step(n.id, 'down')} disabled={busy || index === list.length - 1} aria-label={`Ниже: «${n.name}»`}>
                  <Icon name="arrow-down" size={14} />
                </button>
                <Link href={`/admin/catalog/categories?new=1&parent=${n.id}`} className="cat-tree__tool" aria-label={`Добавить подкатегорию в «${n.name}»`} prefetch={false}>
                  <Icon name="plus" size={14} />
                </Link>
              </span>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className={`cat-tree__eye${n.hidden ? ' is-hidden' : ''}`}
                onClick={() => void toggleVisible(n)}
                aria-pressed={!n.hidden}
                aria-label={n.hidden ? `Показать «${n.name}» на сайте` : `Скрыть «${n.name}» с сайта`}
                title={n.hidden ? 'Скрыта на сайте — показать' : n.effectiveHidden ? 'Скрыта через родителя' : 'Видна на сайте — скрыть'}
              >
                <EyeIcon off={n.hidden || n.effectiveHidden} />
              </button>
            ) : (
              <span className={`cat-tree__eye cat-tree__eye--static${n.hidden ? ' is-hidden' : ''}`} role="img" aria-label={n.hidden || n.effectiveHidden ? 'Скрыта на сайте' : 'Видна на сайте'}>
                <EyeIcon off={n.hidden || n.effectiveHidden} />
              </span>
            )}
          </div>
          {n.hasChildren && open ? <ul className="cat-tree__list">{renderLevel(n.id, depth + 1, off)}</ul> : null}
        </li>
      );
    });
  }

  return (
    <div className="cat-tree" aria-busy={busy || undefined}>
      <div className="cat-tree__search">
        <Icon name="search" size={16} />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск категории…" aria-label="Поиск категории" autoComplete="off" maxLength={100} />
      </div>

      {hits !== null && query.trim() !== '' ? (
        <div className="cat-tree__hits" role="region" aria-label="Результаты поиска">
          {hits.length === 0 ? (
            <p className="cat-tree__empty">Ничего не найдено</p>
          ) : (
            <ul>
              {hits.map((h) => (
                <li key={h.id}>
                  <Link href={href(h.id)} onClick={() => setQuery('')} prefetch={false}>
                    <strong>{h.name}</strong>
                    <small>{h.path}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {canWrite ? (
            <div className="cat-tree__select-bar" role="group" aria-label="Выбор категорий">
              <button type="button" className="ak-btn ak-btn--sm ak-btn--outline" onClick={() => void selectScope({ level: selectedId === null ? null : activeParent })}>
                Все на уровне
              </button>
              {selectedId !== null ? (
                <button type="button" className="ak-btn ak-btn--sm ak-btn--outline" onClick={() => void selectScope({ subtree: selectedId })}>
                  Всё поддерево
                </button>
              ) : null}
              {selected.size > 0 ? (
                <button type="button" className="ak-btn ak-btn--sm ak-btn--outline" onClick={() => setSelected(new Set())}>
                  Снять выбор
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="cat-tree__all">
            <Icon name="grid" size={16} />
            <Link href="/admin/catalog/categories" prefetch={false} className="cat-tree__name">
              Все категории
            </Link>
            <span className="cat-tree__count" title="Опубликованные видимые товары магазина">
              {total}
            </span>
          </div>
          <ul className="cat-tree__list cat-tree__list--root" role="tree" aria-label="Структура категорий">
            {renderLevel(null, 0, false)}
          </ul>
        </>
      )}

      {canWrite && selected.size > 0 ? (
        <div className="cat-bulk" role="region" aria-label="Массовые действия с категориями">
          <p className="cat-bulk__count" role="status">
            Выбрано: {selected.size}
          </p>
          <div className="cat-bulk__actions">
            <button type="button" className="ak-btn ak-btn--outline" disabled={busy} onClick={() => void runBulk({ type: 'hide' })}>
              Скрыть выбранные
            </button>
            <button type="button" className="ak-btn ak-btn--outline" disabled={busy} onClick={() => void runBulk({ type: 'show' })}>
              Показать выбранные
            </button>
          </div>
          <div className="cat-bulk__move">
            <label htmlFor="cat-bulk-move" className="visually-hidden">
              Перенести выбранные в
            </label>
            <select id="cat-bulk-move" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">Перенести в…</option>
              <option value="root">В корень (без родителя)</option>
              {parentChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <button type="button" className="ak-btn ak-btn--primary" disabled={busy || moveTo === ''} onClick={() => void runBulk({ type: 'move', parentId: moveTo === 'root' ? null : Number(moveTo) })}>
              Перенести
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M3 3l18 18" /> : null}
    </svg>
  );
}
