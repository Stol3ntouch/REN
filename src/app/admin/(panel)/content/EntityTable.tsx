import Link from 'next/link';
import type { ReactNode } from 'react';
import { BANNER_POSITION_LABELS, type ListEntityKey } from '@/domain/content/fields';
import { contentStatus, CONTENT_STATUS_LABELS, pagePath } from '@/domain/content/queries';
import { formatRub } from '@/domain/pricing/format';
import { getDb } from '@/server/db/connection';
import type { BannerRow } from '@/server/db/repositories/banners';
import type { CompanyReviewRow } from '@/server/db/repositories/company-reviews';
import type { NewsRow } from '@/server/db/repositories/news';
import { newsCategoriesRepo, type NewsCategoryRow } from '@/server/db/repositories/news-categories';
import type { PageRow } from '@/server/db/repositories/pages';
import type { PromotionRow } from '@/server/db/repositories/promotions';
import { serviceCategoriesRepo, type ServiceCategoryRow } from '@/server/db/repositories/service-categories';
import type { ServiceRow } from '@/server/db/repositories/services';
import { DataTable, type DataTableColumn } from '@/ui/admin/kit/DataTable';
import { StatusBadge, type StatusTone } from '@/ui/admin/kit/StatusBadge';
import type { SearchParams, SortDir } from '@/ui/admin/kit/url';
import { isPageHideLocked } from '@/domain/content/queries';
import { RowActions } from './RowActions';

export const ENTITY_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  scheduled: 'Запланирована',
  published: 'Опубликована',
  hidden: 'Скрыта',
  system: 'Системные',
  custom: 'Свои',
  active: 'Действует',
  inactive: 'Отключён',
  hero: 'Главная: слайдер',
  category: 'Страница категории',
  strip: 'Полоса над шапкой',
  middle: 'Главная: полоса',
  finished: 'Завершена',
  upcoming: 'Ещё не началась',
};

const DATE = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: 'Europe/Moscow' });
const DATETIME = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const when = (ms: number | null, withTime = false): string => (ms === null || ms === 0 ? '—' : (withTime ? DATETIME : DATE).format(new Date(ms)));
const period = (a: number | null, b: number | null): string => (a === null && b === null ? 'без ограничений' : `${a === null ? '…' : when(a)} — ${b === null ? '…' : when(b)}`);

type AnyRow = PageRow | BannerRow | NewsRow | NewsCategoryRow | ServiceRow | ServiceCategoryRow | PromotionRow | CompanyReviewRow;

function Title({ href, children, note }: { href: string; children: ReactNode; note?: ReactNode }) {
  return (
    <>
      <Link href={href} className="ak-link">
        <strong>{children}</strong>
      </Link>
      {note ? <div className="ak-field__hint">{note}</div> : null}
    </>
  );
}

const badge = (tone: StatusTone, text: string) => <StatusBadge tone={tone}>{text}</StatusBadge>;

function publicationBadge(r: { published: boolean; publishedAt: number | null }, now: number) {
  const s = contentStatus(r, now);
  return badge(s === 'published' ? 'success' : s === 'scheduled' ? 'info' : 'warning', CONTENT_STATUS_LABELS[s]);
}

/** Текущее время вынесено из тела компонента: список строится на каждый запрос заново. */
const currentTime = (): number => Date.now();

export function EntityTable({ entity, rows, basePath, params, sort, dir, back }: { entity: ListEntityKey; rows: AnyRow[]; basePath: string; params: SearchParams; sort: string | null; dir: SortDir; back: string }) {
  const now = currentTime();
  const db = getDb();
  const newsCats = new Map(newsCategoriesRepo.list(db).map((c) => [c.id, c.name]));
  const serviceCats = new Map(serviceCategoriesRepo.list(db).map((c) => [c.id, c.name]));
  const href = (r: { id: number }) => `/admin/content/${entity}/${r.id}`;
  const actions = (r: { id: number }, name: string, extra: Partial<Parameters<typeof RowActions>[0]> = {}) => <RowActions entity={entity} id={r.id} name={name} back={back} {...extra} />;
  const common = { basePath, params, sort, dir: dir as SortDir, rowKey: (r: { id: number }) => r.id, empty: { title: 'Пока ничего нет', description: 'Создайте первую запись кнопкой сверху. Пустые разделы на сайте не показываются.' } };
  const act = <T extends { id: number }>(render: (r: T) => ReactNode): DataTableColumn<T> => ({ key: 'actions', header: 'Действия', cell: render, width: '1%' });

  switch (entity) {
    case 'pages': {
      const cols: DataTableColumn<PageRow>[] = [
        { key: 'title', header: 'Страница', sortKey: 'title', cell: (r) => <Title href={href(r)} note={`${pagePath(r)}${r.key ? ' · системная' : ''}${r.legalDraft ? ' · черновик, проверить юристом' : ''}`}>{r.title}</Title> },
        { key: 'status', header: 'Статус', cell: (r) => (r.hiddenByAdmin ? badge('neutral', 'Скрыта на сайте') : publicationBadge(r, now)) },
        { key: 'published', header: 'Публикация', sortKey: 'published', hideOnNarrow: true, cell: (r) => when(r.publishedAt, true) },
        { key: 'updated', header: 'Обновлена', sortKey: 'updated', hideOnNarrow: true, cell: (r) => when(r.updatedAt) },
        act<PageRow>((r) => actions(r, r.title, { visible: !r.hiddenByAdmin, canToggle: !isPageHideLocked(r) || r.hiddenByAdmin, canDelete: r.key === null, deleteNote: 'Страница будет удалена вместе с историей версий.' })),
      ];
      return <DataTable<PageRow> caption="Страницы" columns={cols} rows={rows as PageRow[]} {...common} />;
    }
    case 'banners': {
      const cols: DataTableColumn<BannerRow>[] = [
        { key: 'title', header: 'Баннер', sortKey: 'title', cell: (r) => <Title href={href(r)} note={r.heading ?? undefined}>{r.title}</Title> },
        { key: 'position', header: 'Позиция', sortKey: 'position', cell: (r) => BANNER_POSITION_LABELS[r.position] ?? r.position },
        { key: 'period', header: 'Период показа', hideOnNarrow: true, cell: (r) => period(r.startsAt, r.endsAt) },
        { key: 'status', header: 'Статус', cell: (r) => badge(r.status === 'active' ? 'success' : 'neutral', r.status === 'active' ? 'Активен' : 'Отключён') },
        { key: 'sort', header: 'Порядок', sortKey: 'sort', align: 'right', hideOnNarrow: true, cell: (r) => r.sort },
        act<BannerRow>((r) => actions(r, r.title, { visible: r.status === 'active' })),
      ];
      return <DataTable<BannerRow> caption="Баннеры" columns={cols} rows={rows as BannerRow[]} {...common} />;
    }
    case 'news': {
      const cols: DataTableColumn<NewsRow>[] = [
        { key: 'title', header: 'Новость', sortKey: 'title', cell: (r) => <Title href={href(r)} note={`/news/${r.slug}`}>{r.title}</Title> },
        { key: 'category', header: 'Категория', hideOnNarrow: true, cell: (r) => (r.categoryId ? (newsCats.get(r.categoryId) ?? '—') : '—') },
        { key: 'author', header: 'Автор', hideOnNarrow: true, cell: (r) => r.authorName ?? '—' },
        { key: 'status', header: 'Статус', cell: (r) => publicationBadge(r, now) },
        { key: 'published', header: 'Дата', sortKey: 'published', cell: (r) => when(r.publishedAt ?? r.updatedAt, true) },
        act<NewsRow>((r) => actions(r, r.title, { visible: r.published })),
      ];
      return <DataTable<NewsRow> caption="Новости" columns={cols} rows={rows as NewsRow[]} {...common} />;
    }
    case 'news-categories': {
      const cols: DataTableColumn<NewsCategoryRow>[] = [
        { key: 'name', header: 'Категория', sortKey: 'name', cell: (r) => <Title href={href(r)} note={`/${r.slug}`}>{r.name}</Title> },
        { key: 'usage', header: 'Новостей', align: 'right', cell: (r) => newsCategoriesRepo.usage(db, r.id) },
        { key: 'sort', header: 'Порядок', sortKey: 'sort', align: 'right', cell: (r) => r.sort },
        act<NewsCategoryRow>((r) => actions(r, r.name, { canToggle: false, canDuplicate: false, deleteNote: 'Новости останутся, но без категории.' })),
      ];
      return <DataTable<NewsCategoryRow> caption="Категории новостей" columns={cols} rows={rows as NewsCategoryRow[]} {...common} />;
    }
    case 'services': {
      const cols: DataTableColumn<ServiceRow>[] = [
        { key: 'title', header: 'Услуга', sortKey: 'title', cell: (r) => <Title href={href(r)} note={`/services/${r.slug}`}>{r.title}</Title> },
        { key: 'category', header: 'Категория', hideOnNarrow: true, cell: (r) => (r.categoryId ? (serviceCats.get(r.categoryId) ?? '—') : '—') },
        { key: 'price', header: 'Стоимость', hideOnNarrow: true, cell: (r) => r.priceText ?? '—' },
        { key: 'status', header: 'Статус', cell: (r) => badge(r.published ? 'success' : 'neutral', r.published ? 'Опубликована' : 'Скрыта') },
        { key: 'sort', header: 'Порядок', sortKey: 'sort', align: 'right', hideOnNarrow: true, cell: (r) => r.sort },
        act<ServiceRow>((r) => actions(r, r.title, { visible: r.published })),
      ];
      return <DataTable<ServiceRow> caption="Услуги" columns={cols} rows={rows as ServiceRow[]} {...common} />;
    }
    case 'service-categories': {
      const cols: DataTableColumn<ServiceCategoryRow>[] = [
        { key: 'name', header: 'Категория', sortKey: 'name', cell: (r) => <Title href={href(r)} note={`/${r.slug}`}>{r.name}</Title> },
        { key: 'usage', header: 'Услуг', align: 'right', cell: (r) => serviceCategoriesRepo.usage(db, r.id) },
        { key: 'sort', header: 'Порядок', sortKey: 'sort', align: 'right', cell: (r) => r.sort },
        act<ServiceCategoryRow>((r) => actions(r, r.name, { canToggle: false, canDuplicate: false, deleteNote: 'Услуги останутся, но без категории.' })),
      ];
      return <DataTable<ServiceCategoryRow> caption="Категории услуг" columns={cols} rows={rows as ServiceCategoryRow[]} {...common} />;
    }
    case 'promotions': {
      const state = (r: PromotionRow) => {
        if (!r.published) return badge('warning', 'Черновик');
        if (r.endsAt !== null && r.endsAt < now) return badge('neutral', 'Завершена');
        if (r.startsAt !== null && r.startsAt > now) return badge('info', 'Ещё не началась');
        return badge('success', 'Действует');
      };
      const discount = (r: PromotionRow) => (r.discountType === 'percent' ? `${r.discountValue}%` : r.discountType === 'fixed' ? formatRub(r.discountValue) : 'информирует');
      const cols: DataTableColumn<PromotionRow>[] = [
        { key: 'title', header: 'Акция', sortKey: 'title', cell: (r) => <Title href={href(r)} note={`/promotions/${r.slug}`}>{r.title}</Title> },
        { key: 'period', header: 'Период', sortKey: 'starts', hideOnNarrow: true, cell: (r) => period(r.startsAt, r.endsAt) },
        { key: 'discount', header: 'Скидка', hideOnNarrow: true, cell: discount },
        { key: 'priority', header: 'Приоритет', sortKey: 'priority', align: 'right', hideOnNarrow: true, cell: (r) => r.priority },
        { key: 'status', header: 'Статус', cell: state },
        act<PromotionRow>((r) => actions(r, r.title, { visible: r.published })),
      ];
      return <DataTable<PromotionRow> caption="Акции" columns={cols} rows={rows as PromotionRow[]} {...common} />;
    }
    case 'reviews': {
      const cols: DataTableColumn<CompanyReviewRow>[] = [
        { key: 'author', header: 'Автор', sortKey: 'author', cell: (r) => <Title href={href(r)} note={r.body.slice(0, 90)}>{r.authorName}</Title> },
        { key: 'rating', header: 'Оценка', hideOnNarrow: true, cell: (r) => (r.rating ? `${r.rating} из 5` : '—') },
        { key: 'date', header: 'Дата', sortKey: 'reviewed', hideOnNarrow: true, cell: (r) => when(r.reviewedAt) },
        { key: 'status', header: 'Статус', cell: (r) => badge(r.published ? 'success' : 'neutral', r.published ? 'Опубликован' : 'Скрыт') },
        act<CompanyReviewRow>((r) => actions(r, r.authorName, { canDuplicate: false, canToggle: false })),
      ];
      return <DataTable<CompanyReviewRow> caption="Отзывы о компании" columns={cols} rows={rows as CompanyReviewRow[]} {...common} />;
    }
  }
}
