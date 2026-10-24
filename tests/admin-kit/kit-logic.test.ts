import { describe, expect, it, vi } from 'vitest';
import { cycleIndex } from '@/ui/admin/kit/focus';
import { clampPageSize, pageCountOf, pageWindow, shownRange } from '@/ui/admin/kit/pagination-model';
import { runOptimistic, TOGGLE_FAILED } from '@/ui/admin/kit/toggle-model';
import { toastReducer, MAX_TOASTS, type ToastItem } from '@/ui/admin/kit/Toaster';
import { attachUnsavedGuard, isLeavingLink, type GuardEnv } from '@/ui/admin/kit/unsaved-guard';
import { validateFile } from '@/ui/admin/kit/upload-model';
import { buildHref, nextSearchHref, parseListParams } from '@/ui/admin/kit/url';
import { isCollapsedCookie, NAV_COOKIE, navCookieString } from '@/ui/admin/kit/shell-constants';
import { initialOf } from '@/ui/admin/kit/labels';

describe('адрес списка: сортировка, страница, поиск', () => {
  it('buildHref сохраняет текущие параметры, переопределяет и убирает пустые', () => {
    expect(buildHref('/admin/catalog', { q: 'пила', page: '3', sort: 'name' }, { page: null, sort: 'price', dir: 'desc' })).toBe('/admin/catalog?q=%D0%BF%D0%B8%D0%BB%D0%B0&sort=price&dir=desc');
    expect(buildHref('/admin/orders', { page: '2' }, { page: null })).toBe('/admin/orders');
  });

  it('parseListParams отбрасывает недопустимое: страница, размер, поле и направление сортировки', () => {
    const opts = { sorts: ['name', 'price'], defaultSort: 'name' };
    expect(parseListParams({ page: '-4', pageSize: '33', sort: 'drop table', dir: 'sideways', q: '  пила  ' }, opts)).toEqual({ page: 1, pageSize: 20, sort: 'name', dir: 'asc', q: 'пила' });
    expect(parseListParams({ page: '7', pageSize: '50', sort: 'price', dir: 'desc' }, opts)).toMatchObject({ page: 7, pageSize: 50, sort: 'price', dir: 'desc' });
  });

  it('nextSearchHref ставит q, сбрасывает страницу, сохраняет остальное; пустой q убирает параметр', () => {
    expect(nextSearchHref('/admin/catalog', '?sort=name&page=4', 'q', ' триммер ')).toBe('/admin/catalog?sort=name&q=%D1%82%D1%80%D0%B8%D0%BC%D0%BC%D0%B5%D1%80');
    expect(nextSearchHref('/admin/catalog', '?q=x&page=2', 'q', '')).toBe('/admin/catalog');
  });
});

describe('пагинация', () => {
  it('окно номеров: 54 страницы', () => {
    expect(pageWindow(1, 54)).toEqual([1, 2, 3, 4, 5, 'gap', 54]);
    expect(pageWindow(4, 54)).toEqual([1, 2, 3, 4, 5, 'gap', 54]);
    expect(pageWindow(5, 54)).toEqual([1, 'gap', 4, 5, 6, 'gap', 54]);
    expect(pageWindow(27, 54)).toEqual([1, 'gap', 26, 27, 28, 'gap', 54]);
    expect(pageWindow(54, 54)).toEqual([1, 'gap', 50, 51, 52, 53, 54]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('число страниц, диапазон «Показано a–b из N», размер страницы', () => {
    expect(pageCountOf(0, 20)).toBe(1);
    expect(pageCountOf(135, 20)).toBe(7);
    expect(shownRange(7, 20, 135)).toEqual({ from: 121, to: 135 });
    expect(shownRange(1, 20, 0)).toEqual({ from: 0, to: 0 });
    expect([10, 20, 50, 100].map(clampPageSize)).toEqual([10, 20, 50, 100]);
    expect(clampPageSize(7)).toBe(20);
  });
});

describe('Toggle: оптимистичное обновление с откатом', () => {
  it('успех — новое значение', async () => {
    await expect(runOptimistic(false, async () => ({ ok: true }))).resolves.toEqual({ checked: true, error: null });
    await expect(runOptimistic(true, () => undefined)).resolves.toEqual({ checked: false, error: null });
  });

  it('действие получает новое значение', async () => {
    const action = vi.fn(async () => undefined);
    await runOptimistic(false, action);
    expect(action).toHaveBeenCalledWith(true);
  });

  it('ответ {ok:false} — откат и текст сервера', async () => {
    await expect(runOptimistic(false, async () => ({ ok: false, message: 'Нет прав' }))).resolves.toEqual({ checked: false, error: 'Нет прав' });
  });

  it('исключение — откат и общий текст (детали исключения не показываются)', async () => {
    const r = await runOptimistic(true, async () => {
      throw new Error('SQLITE_BUSY: секрет');
    });
    expect(r).toEqual({ checked: true, error: TOGGLE_FAILED });
  });
});

describe('фокус внутри диалога', () => {
  it('Tab циклически идёт вперёд, Shift+Tab — назад; фокус снаружи (-1) попадает внутрь', () => {
    expect(cycleIndex(3, 0, false)).toBe(1);
    expect(cycleIndex(3, 2, false)).toBe(0);
    expect(cycleIndex(3, 0, true)).toBe(2);
    expect(cycleIndex(3, 2, true)).toBe(1);
    expect(cycleIndex(3, -1, false)).toBe(0);
    expect(cycleIndex(3, -1, true)).toBe(2);
    expect(cycleIndex(0, -1, false)).toBe(-1);
  });
});

describe('уведомления', () => {
  const t = (id: number): ToastItem => ({ id, kind: 'success', message: `m${id}` });
  it('добавляются в конец, старые вытесняются сверх лимита, закрываются по id', () => {
    let s: ToastItem[] = [];
    for (let i = 1; i <= MAX_TOASTS + 2; i += 1) s = toastReducer(s, { type: 'add', toast: t(i) });
    expect(s.map((x) => x.id)).toEqual([3, 4, 5, 6]);
    expect(toastReducer(s, { type: 'remove', id: 4 }).map((x) => x.id)).toEqual([3, 5, 6]);
  });
});

describe('загрузка файла: клиентская проверка', () => {
  it('принимает допустимый тип и размер', () => {
    expect(validateFile({ name: 'a.png', size: 1000, type: 'image/png' })).toBeNull();
  });
  it('отклоняет чужой тип, пустой и слишком большой файл с понятным текстом', () => {
    expect(validateFile({ name: 'a.exe', size: 10, type: 'application/x-msdownload' })).toBe('Допустимые форматы: JPG, PNG, WebP');
    expect(validateFile({ name: 'a.png', size: 0, type: 'image/png' })).toBe('Файл пустой');
    expect(validateFile({ name: 'a.png', size: 6 * 1024 * 1024, type: 'image/png' })).toBe('Файл больше 5 МБ');
    expect(validateFile({ name: 'a.ico', size: 600 * 1024, type: 'image/x-icon' }, { accept: ['image/x-icon'], maxBytes: 512 * 1024 })).toBe('Файл больше 512 КБ');
  });
});

describe('защита от потери несохранённых изменений', () => {
  type Handler = (e: Record<string, unknown>) => void;
  function makeEnv(confirmAnswer: boolean) {
    const win = new Map<string, Handler>();
    const doc = new Map<string, Handler>();
    const confirm = vi.fn(() => confirmAnswer);
    const env = {
      win: {
        addEventListener: (t: string, f: Handler) => win.set(t, f),
        removeEventListener: (t: string) => win.delete(t),
        confirm,
        location: { origin: 'https://shop.test', href: 'https://shop.test/admin/catalog/1' },
      },
      doc: { addEventListener: (t: string, f: Handler) => doc.set(t, f), removeEventListener: (t: string) => doc.delete(t) },
    } as unknown as GuardEnv;
    return { env, win, doc, confirm };
  }
  const link = (href: string, extra: Record<string, unknown> = {}) => ({ href, target: '', hasAttribute: () => false, ...extra });
  const click = (a: ReturnType<typeof link> | null, extra: Record<string, unknown> = {}) => {
    const e = { target: { closest: () => a }, button: 0, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
    return e;
  };

  it('без изменений ничего не блокируется', () => {
    const { env, win, doc, confirm } = makeEnv(false);
    attachUnsavedGuard(env, () => false);
    const before = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    win.get('beforeunload')!(before);
    expect(before.preventDefault).not.toHaveBeenCalled();
    const e = click(link('https://shop.test/admin/orders'));
    doc.get('click')!(e);
    expect(confirm).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('с изменениями: закрытие вкладки запрашивает подтверждение браузера', () => {
    const { env, win } = makeEnv(true);
    attachUnsavedGuard(env, () => true);
    const e = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    win.get('beforeunload')!(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.returnValue).toBe('');
  });

  it('с изменениями: переход по внутренней ссылке — отказ в confirm отменяет переход, согласие пропускает', () => {
    const no = makeEnv(false);
    attachUnsavedGuard(no.env, () => true);
    const stopped = click(link('https://shop.test/admin/orders'));
    no.doc.get('click')!(stopped);
    expect(no.confirm).toHaveBeenCalledTimes(1);
    expect(stopped.preventDefault).toHaveBeenCalled();
    expect(stopped.stopPropagation).toHaveBeenCalled();

    const yes = makeEnv(true);
    attachUnsavedGuard(yes.env, () => true);
    const passed = click(link('https://shop.test/admin/orders'));
    yes.doc.get('click')!(passed);
    expect(passed.preventDefault).not.toHaveBeenCalled();
  });

  it('якорь на этой странице, новая вкладка, внешний сайт и клик с Ctrl не считаются уходом', () => {
    const here = 'https://shop.test/admin/catalog/1';
    const origin = 'https://shop.test';
    expect(isLeavingLink(link('https://shop.test/admin/catalog/1#top'), { button: 0 }, here, origin)).toBe(false);
    expect(isLeavingLink(link('https://shop.test/admin/orders', { target: '_blank' }), { button: 0 }, here, origin)).toBe(false);
    expect(isLeavingLink(link('https://other.example/x'), { button: 0 }, here, origin)).toBe(false);
    expect(isLeavingLink(link('https://shop.test/admin/orders'), { button: 0, ctrlKey: true }, here, origin)).toBe(false);
    expect(isLeavingLink(link('https://shop.test/admin/orders'), { button: 0 }, here, origin)).toBe(true);
  });

  it('отключение снимает обработчики', () => {
    const { env, win, doc } = makeEnv(true);
    const detach = attachUnsavedGuard(env, () => true);
    detach();
    expect(win.size + doc.size).toBe(0);
  });
});

describe('состояние боковой панели в cookie', () => {
  it('значение collapsed читается сервером; cookie ограничена /admin и живёт год', () => {
    expect(isCollapsedCookie('collapsed')).toBe(true);
    expect(isCollapsedCookie('expanded')).toBe(false);
    expect(isCollapsedCookie(undefined)).toBe(false);
    const s = navCookieString(true, true);
    expect(s).toContain(`${NAV_COOKIE}=collapsed`);
    expect(s).toContain('path=/admin');
    expect(s).toContain('max-age=31536000');
    expect(s).toContain('Secure');
    expect(navCookieString(false, false)).not.toContain('Secure');
  });

  it('инициал аватара: имя, иначе логин', () => {
    expect(initialOf('иван', 'x')).toBe('И');
    expect(initialOf(null, 'boss@shop.test')).toBe('B');
    expect(initialOf('  ', '')).toBe('?');
  });
});
