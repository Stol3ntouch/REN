import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StaffSession } from '@/domain/admin/permissions';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/catalog/categories/7',
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import * as kit from '@/ui/admin/kit';
import {
  Breadcrumbs,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FileUploader,
  FilterPanel,
  FormField,
  ImagePreview,
  LoadingState,
  PageHeader,
  Pagination,
  PermissionGate,
  SaveBar,
  SelectField,
  StatusBadge,
  TabPanel,
  Tabs,
  TextAreaField,
  Toggle,
  Topbar,
} from '@/ui/admin/kit';
import { Sidebar } from '@/ui/admin/kit/Sidebar';
import { ShellProvider } from '@/ui/admin/kit/shell-context';
import { SoonView } from '@/ui/admin/kit/SoonView';
import { ADMIN_NAV_GROUPS, visibleNavGroups } from '@/ui/admin/nav';

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const admin: StaffSession = { staffId: 1, email: 'boss@shop.test', name: 'Иван Петров', role: 'admin' };
const manager: StaffSession = { staffId: 2, email: 'mgr@shop.test', name: null, role: 'manager' };
const noop = async () => undefined;

describe('kit: все компоненты из брифа экспортируются', () => {
  it('24 компонента и useToast', () => {
    const names = [
      'AdminLayout', 'Sidebar', 'Topbar', 'Breadcrumbs', 'PageHeader', 'DataTable', 'Pagination', 'SearchInput', 'FilterPanel', 'StatusBadge', 'Toggle', 'ConfirmDialog',
      'FormField', 'SelectField', 'TextAreaField', 'FileUploader', 'ImagePreview', 'Tabs', 'EmptyState', 'LoadingState', 'ErrorState', 'Toaster', 'useToast', 'PermissionGate',
      'SaveBar', 'UnsavedChangesGuard', 'SearchBox', 'NotificationBell',
    ];
    for (const n of names) expect(typeof (kit as Record<string, unknown>)[n], n).toBe('function');
  });
});

describe('Sidebar и Topbar', () => {
  const shell = (collapsed: boolean, role = admin) => html(<ShellProvider initialCollapsed={collapsed}><Sidebar groups={visibleNavGroups(role.role)} /></ShellProvider>);

  it('группы с заголовками, логотип, активный пункт и его подраздел подсвечены, aria-current только у одного', () => {
    const out = shell(false);
    for (const g of ['Каталог', 'Продажи', 'Контент', 'Услуги', 'Настройки']) expect(out).toContain(`>${g}</h2>`);
    expect(out).toContain('/brand/logo-dark.png');
    expect(out).toContain('aria-label="Разделы админки"');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="page"[^>]*>(?:<svg[\s\S]*?<\/svg>)<span class="ak-nav__text">Категории</);
    expect(out).toContain('Свернуть меню');
    expect(out).toContain('data-collapsed="false"');
  });

  it('свёрнутое состояние из cookie попадает в серверную разметку (без мигания)', () => {
    const out = shell(true);
    expect(out).toContain('data-collapsed="true"');
    expect(out).toContain('Развернуть меню');
  });

  it('раскрывающийся подраздел: кнопка с aria-expanded и aria-controls', () => {
    const out = html(<ShellProvider initialCollapsed={false}><Sidebar groups={visibleNavGroups('admin')} /></ShellProvider>);
    expect(out).toMatch(/aria-expanded="false"[^>]*aria-controls="ak-sub-store-settings"/);
    expect(out).toContain('id="ak-sub-store-settings"');
  });

  it('менеджеру не показываются пункты без права', () => {
    const out = shell(false, manager);
    expect(out).not.toContain('Пользователи');
    expect(out).not.toContain('Резервные копии');
    expect(out).toContain('Заказы');
  });

  it('Topbar: название, подпись, «Перейти на сайт» в новой вкладке, имя и роль; поиск и уведомления скрыты флагами', () => {
    const out = html(<ShellProvider initialCollapsed={false}><Topbar session={admin} logout={noop} /></ShellProvider>);
    expect(out).toContain('Админ-панель');
    expect(out).toContain('Управление интернет-магазином');
    expect(out).toMatch(/href="\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"|target="_blank"[^>]*rel="noopener noreferrer"/);
    expect(out).toContain('Перейти на сайт');
    expect(out).toContain('Иван Петров');
    expect(out).toContain('Администратор');
    expect(out).toContain('>И</span>');
    expect(out).not.toContain('role="search"');
    expect(out).not.toContain('Уведомления');
    expect(out).toContain('aria-label="Открыть меню"');
  });

  it('Topbar: при включённых флагах появляются поиск и колокольчик с индикатором', () => {
    const out = html(
      <ShellProvider initialCollapsed={false}>
        <Topbar session={manager} logout={noop} features={{ search: true, notifications: true }} unreadNotifications={3} />
      </ShellProvider>,
    );
    expect(out).toContain('role="search"');
    expect(out).toContain('Уведомления: непрочитанных 3');
    expect(out).toContain('mgr@shop.test'); // нет имени — логин
    expect(out).toContain('Менеджер');
  });
});

describe('навигационные и служебные компоненты', () => {
  it('Breadcrumbs: последняя крошка — текущая страница без ссылки', () => {
    const out = html(<Breadcrumbs items={[{ label: 'Главная', href: '/admin' }, { label: 'Заказы', href: '/admin/orders' }, { label: 'RTS-1' }]} />);
    expect(out).toContain('aria-label="Хлебные крошки"');
    expect(out).toContain('<span aria-current="page">RTS-1</span>');
    expect(out.match(/<a /g)).toHaveLength(2);
  });

  it('PageHeader: один h1, описание и действия', () => {
    const out = html(<PageHeader title="Заказы" description="Все заказы магазина" actions={<button>Экспорт</button>} />);
    expect(out.match(/<h1>/g)).toHaveLength(1);
    expect(out).toContain('Все заказы магазина');
    expect(out).toContain('Экспорт');
  });

  it('Tabs: состояние в адресе (?tab=), первая вкладка без параметра, активная — aria-current', () => {
    const out = html(<Tabs items={[{ key: 'main', label: 'Основное' }, { key: 'seo', label: 'SEO', count: 2 }]} active="seo" basePath="/admin/catalog/5" params={{ q: 'x', page: '3' }} />);
    expect(out).toContain('href="/admin/catalog/5?q=x"');
    expect(out).toContain('href="/admin/catalog/5?q=x&amp;tab=seo"');
    expect(out).toMatch(/aria-current="page"[^>]*>SEO \(2\)/);
    expect(html(<TabPanel active="seo">текст</TabPanel>)).toContain('aria-labelledby="tab-seo"');
  });

  it('PermissionGate: показывает содержимое только при праве, иначе fallback', () => {
    expect(html(<PermissionGate session={admin} permission="staff.manage">секрет</PermissionGate>)).toBe('секрет');
    expect(html(<PermissionGate session={manager} permission="staff.manage" fallback="нет прав">секрет</PermissionGate>)).toBe('нет прав');
    expect(html(<PermissionGate session={null} permission="orders.read">секрет</PermissionGate>)).toBe('');
  });

  it('SoonView: честный текст и ссылка на работающий раздел; чужой адрес — 404', () => {
    // любой пункт, который ещё ждёт своего тикета и имеет работающую замену (C09 свои пункты уже сдал)
    const leaves = ADMIN_NAV_GROUPS.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]));
    const pending = leaves.find((i) => i.pending);
    if (pending) {
      const out = html(<SoonView href={pending.href} />);
      expect(out).toContain('Раздел появится после завершения сборки');
      if (pending.interim) expect(out).toContain(`href="${pending.interim.href}"`);
    }
    // сданные разделы (C09: обращения, ремонт) заглушкой не показываются
    expect(() => html(<SoonView href="/admin/inquiries" />)).toThrow('NEXT_NOT_FOUND');
    expect(() => html(<SoonView href="/admin/orders" />)).toThrow('NEXT_NOT_FOUND');
  });
});

describe('поля форм', () => {
  it('FormField: подпись связана с полем, ошибка и подсказка — через aria-describedby, aria-invalid', () => {
    const out = html(<FormField name="title" label="Название" required hint="До 100 символов" error="Обязательное поле" defaultValue="" />);
    expect(out).toContain('<label for="f-title"');
    expect(out).toContain('id="f-title"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="f-title-hint f-title-error"');
    expect(out).toContain('id="f-title-error"');
    expect(out).toContain('required');
  });

  it('без ошибки нет aria-invalid и блока ошибки', () => {
    const out = html(<FormField name="title" label="Название" />);
    expect(out).not.toContain('aria-invalid');
    expect(out).not.toContain('-error');
  });

  it('SelectField и TextAreaField: подпись, опции, placeholder, ошибка', () => {
    const sel = html(<SelectField name="status" label="Статус" placeholder="Выберите" options={[{ value: 'a', label: 'Активен' }, { value: 'b', label: 'Скрыт' }]} error={['Выберите статус']} />);
    expect(sel).toContain('<option value="">Выберите</option>');
    expect(sel).toContain('<option value="a">Активен</option>');
    expect(sel).toContain('aria-describedby="f-status-error"');
    const ta = html(<TextAreaField name="body" label="Текст" rows={6} />);
    expect(ta).toContain('<textarea');
    expect(ta).toContain('rows="6"');
  });

  it('StatusBadge: текст всегда есть (цвет не единственный признак)', () => {
    expect(html(<StatusBadge tone="danger">Нет в наличии</StatusBadge>)).toContain('Нет в наличии');
  });
});

describe('состояния', () => {
  it('EmptyState / LoadingState / ErrorState: роли для скринридера, без бесконечного спиннера', () => {
    expect(html(<EmptyState title="Пусто" action={<a href="/x">Добавить</a>}>Здесь пока ничего нет</EmptyState>)).toContain('Добавить');
    const loading = html(<LoadingState label="Загрузка заказов…" />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('Загрузка заказов…');
    expect(loading).not.toContain('spinner');
    expect(html(<ErrorState title="Сбой">Повторите позже</ErrorState>)).toContain('role="alert"');
  });
});

describe('DataTable', () => {
  type Row = { id: number; name: string; price: number };
  const rows: Row[] = [
    { id: 1, name: 'Триммер', price: 1200 },
    { id: 2, name: 'Пила', price: 3400 },
  ];
  const columns = [
    { key: 'name', header: 'Название', sortKey: 'name', cell: (r: Row) => r.name },
    { key: 'price', header: 'Цена', sortKey: 'price', align: 'right' as const, cell: (r: Row) => String(r.price) },
    { key: 'note', header: 'Заметка', cell: () => '—' },
  ];
  const base = { caption: 'Товары', columns, rows, rowKey: (r: Row) => r.id, basePath: '/admin/catalog' };

  it('сортировка — ссылки с aria-sort; повторный клик по активной колонке меняет направление; страница сбрасывается', () => {
    const out = html(<DataTable {...base} params={{ q: 'п', page: '4' }} sort="name" dir="asc" />);
    expect(out).toContain('aria-sort="ascending"');
    expect(out).toContain('aria-sort="none"');
    expect(out).toContain('href="/admin/catalog?q=%D0%BF&amp;sort=name&amp;dir=desc"');
    expect(out).toContain('href="/admin/catalog?q=%D0%BF&amp;sort=price&amp;dir=asc"');
    expect(out).not.toContain('page=4');
    expect(out).toContain('<caption class="visually-hidden">Товары</caption>');
    expect(out).toContain('Триммер');
  });

  it('чекбоксы: у каждой строки подпись и связь с формой массового действия; «выбрать все» подписан', () => {
    const out = html(<DataTable {...base} selectable bulkFormId="bulk" bulkActions={<form id="bulk" />} rowLabel={(r) => `Выбрать ${r.name}`} />);
    expect(out).toContain('aria-label="Выбрать все строки на странице"');
    expect(out).toContain('aria-label="Выбрать Триммер"');
    expect(out).toMatch(/<input[^>]*form="bulk"[^>]*name="ids" value="1"/);
    expect(out).toContain('role="region" aria-label="Массовые действия"');
    expect(out).toContain('hidden=""'); // панель скрыта, пока ничего не выбрано
  });

  it('пусто, ошибка и загрузка', () => {
    expect(html(<DataTable {...base} rows={[]} empty={{ title: 'Товаров нет', description: 'Импортируйте каталог' }} />)).toContain('Товаров нет');
    const err = html(<DataTable {...base} error="Не удалось загрузить список" />);
    expect(err).toContain('role="alert"');
    expect(err).not.toContain('<table');
    const loading = html(<DataTable {...base} loading />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain('Триммер');
  });
});

describe('Pagination', () => {
  it('«Показано a–b из N», номера ссылками, текущая — aria-current, остальные параметры сохраняются', () => {
    const out = html(<Pagination page={3} pageSize={20} total={135} basePath="/admin/orders" params={{ status: 'new', page: '3' }} />);
    expect(out).toContain('Показано 41–60 из 135');
    expect(out).toMatch(/aria-current="page"[^>]*aria-label="Страница 3"|aria-label="Страница 3"[^>]*aria-current="page"/);
    expect(out).toContain('href="/admin/orders?status=new&amp;page=2"');
    expect(out).toContain('href="/admin/orders?status=new&amp;page=7"');
    expect(out).toContain('rel="prev"');
    expect(out).toContain('rel="next"');
    expect(out).toContain('Показывать:');
    for (const s of [10, 20, 50, 100]) expect(out).toContain(`<option value="${s}"`);
  });

  it('первая страница без параметра page; на единственной странице нет номеров; пустой список', () => {
    expect(html(<Pagination page={1} pageSize={10} total={35} basePath="/a" />)).toContain('href="/a"');
    expect(html(<Pagination page={1} pageSize={50} total={10} basePath="/a" />)).not.toContain('aria-label="Страницы"');
    expect(html(<Pagination page={1} pageSize={20} total={0} basePath="/a" />)).toContain('Нет записей');
  });
});

describe('FilterPanel', () => {
  it('GET-форма на тот же адрес; сортировка сохраняется скрытым полем; «Сбросить» убирает фильтры, но не сортировку', () => {
    const out = html(
      <FilterPanel basePath="/admin/orders" params={{ status: 'new', sort: 'date', page: '2' }}>
        <FormField name="status" label="Статус" />
      </FilterPanel>,
    );
    expect(out).toContain('method="get"');
    expect(out).toContain('action="/admin/orders"');
    expect(out).toContain('<input type="hidden" name="sort" value="date"/>');
    expect(out).toContain('href="/admin/orders?sort=date"');
  });
});

describe('ConfirmDialog', () => {
  const base = { title: 'Удалить товар?', description: 'Действие нельзя отменить', confirmLabel: 'Удалить', onConfirm: () => undefined, onCancel: () => undefined };
  it('закрыт — ничего не рисуется', () => {
    expect(html(<ConfirmDialog {...base} open={false} />)).toBe('');
  });
  it('открыт — модальный диалог с заголовком и описанием для скринридера; опасное действие — красная кнопка', () => {
    const out = html(<ConfirmDialog {...base} open tone="danger" />);
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toMatch(/aria-labelledby="[^"]+"/);
    expect(out).toMatch(/aria-describedby="[^"]+"/);
    expect(out).toContain('ak-btn--danger');
    expect(out).toContain('Отмена');
    expect(out).toContain('Удалить');
  });
  it('во время выполнения кнопки заблокированы', () => {
    const out = html(<ConfirmDialog {...base} open pending />);
    expect(out.match(/disabled=""/g)).toHaveLength(2);
    expect(out).toContain('Выполняется…');
  });
});

describe('Toggle, SaveBar, загрузка файла', () => {
  it('Toggle: role="switch", aria-checked, имя из подписи; name добавляет скрытое поле формы', () => {
    const out = html(<Toggle checked label="Активна" name="active" />);
    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-checked="true"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(out).toContain(`id="${labelledBy}" class="ak-toggle__label">Активна`);
    expect(out).toContain('<input type="hidden" name="active" value="1"/>');
    expect(html(<Toggle checked={false} label="Показывать" hideLabel />)).toContain('aria-label="Показывать"');
  });

  it('SaveBar: «Сохранить изменения» и «Отмена» (сброс формы или ссылка)', () => {
    const reset = html(<SaveBar />);
    expect(reset).toContain('Сохранить изменения');
    expect(reset).toContain('type="reset"');
    expect(html(<SaveBar cancelHref="/admin/orders" />)).toContain('href="/admin/orders"');
  });

  it('SaveBar: при отправке кнопки заблокированы и подпись меняется', () => {
    const out = html(<SaveBar pending />);
    expect(out).toContain('Сохранение…');
    expect(out.match(/disabled=""/g)).toHaveLength(2);
    expect(out).toContain('aria-busy="true"');
  });

  it('FileUploader: поле выбора подписано, подсказка о форматах и размере; с upload файл не уходит с формой, путь — в скрытом поле', () => {
    const out = html(<FileUploader name="logo" label="Логотип" upload={async () => ({ ok: false, error: 'x' })} />);
    expect(out).toContain('Логотип');
    expect(out).toContain('JPG, PNG, WebP до 5 МБ');
    expect(out).toContain('type="file"');
    expect(out).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(out).toContain('name="logo_path"');
    expect(out).not.toMatch(/type="file"[^>]*name="logo"/);
    expect(html(<FileUploader name="logo" label="Логотип" />)).toMatch(/name="logo"/);
  });

  it('ImagePreview: alt обязателен и выводится', () => {
    expect(html(<ImagePreview src="/a.png" alt="Логотип магазина" />)).toContain('alt="Логотип магазина"');
  });
});
