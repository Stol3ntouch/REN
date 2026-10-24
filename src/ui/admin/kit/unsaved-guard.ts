export const UNSAVED_MESSAGE = 'Есть несохранённые изменения. Уйти со страницы без сохранения?';

type Listener = (event: Event) => void;
type Target = {
  addEventListener(type: string, fn: Listener, capture?: boolean): void;
  removeEventListener(type: string, fn: Listener, capture?: boolean): void;
};

type GuardEvent = {
  defaultPrevented?: boolean;
  preventDefault: () => void;
  stopPropagation?: () => void;
  returnValue?: unknown;
  target?: unknown;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

type AnchorLike = { href?: string; target?: string; hasAttribute?: (n: string) => boolean; getAttribute?: (n: string) => string | null; origin?: string };

export type GuardEnv = {
  win: Target & { confirm: (message?: string) => boolean; location: { origin: string; href: string } };
  doc: Target;
};

/** Ссылка уводит с текущей страницы (внутри сайта, не якорь, не новая вкладка, не скачивание). */
export function isLeavingLink(a: AnchorLike | null, event: Pick<GuardEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, currentHref: string, origin: string): boolean {
  if (!a || !a.href) return false;
  if (event.button !== undefined && event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (a.target && a.target !== '_self') return false;
  if (a.hasAttribute?.('download')) return false;
  let url: URL;
  try {
    url = new URL(a.href, currentHref);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  const here = new URL(currentHref);
  return !(url.pathname === here.pathname && url.search === here.search); // тот же адрес или якорь на этой странице — не уход
}

/**
 * Охрана несохранённых изменений: закрытие вкладки/перезагрузка (beforeunload) и клики по внутренним ссылкам
 * (подтверждение через confirm; отказ отменяет переход). Возвращает функцию отключения.
 * Кнопка «назад» браузера отдельно не перехватывается — для неё остаётся только beforeunload при выходе с сайта.
 */
export function attachUnsavedGuard(env: GuardEnv, isDirty: () => boolean, message: string = UNSAVED_MESSAGE): () => void {
  const onBeforeUnload = (e: GuardEvent): void => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  const onClick = (e: GuardEvent): void => {
    if (!isDirty() || e.defaultPrevented) return;
    const target = e.target as { closest?: (s: string) => unknown } | null;
    const a = (target?.closest?.('a[href]') ?? null) as AnchorLike | null;
    if (!isLeavingLink(a, e, env.win.location.href, env.win.location.origin)) return;
    if (!env.win.confirm(message)) {
      e.preventDefault();
      e.stopPropagation?.();
    }
  };
  env.win.addEventListener('beforeunload', onBeforeUnload as unknown as Listener);
  env.doc.addEventListener('click', onClick as unknown as Listener, true); // до обработчиков Next.js Link
  return () => {
    env.win.removeEventListener('beforeunload', onBeforeUnload as unknown as Listener);
    env.doc.removeEventListener('click', onClick as unknown as Listener, true);
  };
}
