import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSettingsRecord } from '@/domain/content/admin-view';
import { listAdminEntity, LIST_SPECS } from '@/domain/content/admin-list';
import { ENTITY_LABELS, isEntityKey, isListEntityKey, type ListEntityKey } from '@/domain/content/fields';
import { isSectionHidden, type HideableSection } from '@/domain/content/queries';
import { DEFAULT_LOGO_URL, getShopInfo } from '@/domain/content/settings';
import { requireStaffPage } from '@/ui/admin/guard';
import { FilterPanel } from '@/ui/admin/kit/FilterPanel';
import { PageHeader } from '@/ui/admin/kit/PageHeader';
import { Pagination } from '@/ui/admin/kit/Pagination';
import { SearchInput } from '@/ui/admin/kit/SearchInput';
import { SelectField } from '@/ui/admin/kit/SelectField';
import { FlashToast } from '@/ui/admin/kit/Toaster';
import { buildHref, firstParam, parseListParams, type SearchParams } from '@/ui/admin/kit/url';
import '@/ui/cart/admin-orders.css';
import { ContentForm } from '../ContentForm';
import { SectionVisibilityControl } from '../VisibilityControls';
import '../content-admin.css';
import { EntityTable, ENTITY_STATUS_LABELS } from '../EntityTable';

export const metadata: Metadata = { title: 'Контент' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ entity: string }>; searchParams: Promise<SearchParams> };

const ADD_LABEL: Record<ListEntityKey, string> = {
  pages: 'Новая страница',
  banners: 'Новый баннер',
  news: 'Новая новость',
  'news-categories': 'Новая категория',
  services: 'Новая услуга',
  'service-categories': 'Новая категория',
  promotions: 'Новая акция',
  reviews: 'Новый отзыв',
};

/** Список раздела «Контент» (серверные поиск, фильтр, сортировка, страницы) или форма настроек магазина. */
export default async function ContentEntityPage({ params, searchParams }: Props) {
  await requireStaffPage('content.write'); // менеджер → редирект на обзор; обработчики проверяют право отдельно
  const { entity } = await params;
  if (!isEntityKey(entity)) notFound();
  const sp = await searchParams;
  const label = ENTITY_LABELS[entity];

  // старые адреса форм: ?edit=<id> и ?new=1 переводим на страницы правки и создания (флеш-сообщения сохраняются)
  const edit = firstParam(sp.edit);
  const carry = (): string => {
    const q = new URLSearchParams();
    for (const k of ['ok', 'error']) if (firstParam(sp[k])) q.set(k, firstParam(sp[k]));
    const s = q.toString();
    return s ? `?${s}` : '';
  };
  if (entity !== 'settings') {
    if (/^\d+$/.test(edit)) redirect(`/admin/content/${entity}/${edit}${carry()}`);
    if (firstParam(sp.new) === '1') redirect(`/admin/content/${entity}/new${carry()}`);
  }

  if (entity === 'settings') {
    const shop = getShopInfo();
    return (
      <>
        <PageHeader title={label.title} description={label.hint} />
        <FlashToast ok={firstParam(sp.ok)} error={firstParam(sp.error)} okText="Сохранено." />
        <ContentForm entity="settings" record={getSettingsRecord()} previews={{ logo: { src: shop.logoUrl, alt: 'Текущий логотип' } }} cancelHref="/admin/content/settings" />
        {shop.logoUrl === DEFAULT_LOGO_URL ? <p className="ak-field__hint">Сейчас используется логотип по умолчанию.</p> : null}
      </>
    );
  }

  if (!isListEntityKey(entity)) notFound();
  const spec = LIST_SPECS[entity];
  const lp = parseListParams(sp, { sorts: Object.keys(spec.sorts), defaultSort: spec.defaultSort });
  const status = firstParam(sp.status);
  const data = listAdminEntity(entity, { q: lp.q, status: status in (spec.statuses ?? {}) ? status : undefined, sort: lp.sort ?? undefined, dir: firstParam(sp.dir) === 'desc' ? 'desc' : firstParam(sp.dir) === 'asc' ? 'asc' : undefined, page: lp.page, pageSize: lp.pageSize });
  const basePath = `/admin/content/${entity}`;
  const statusOptions = Object.keys(spec.statuses ?? {}).map((k) => ({ value: k, label: ENTITY_STATUS_LABELS[k] ?? k }));
  const back = buildHref(basePath, sp, {});
  const sectionHideable = entity === 'news' || entity === 'promotions' || entity === 'services';

  return (
    <>
      <PageHeader
        title={label.title}
        description={label.hint}
        actions={
          <>
            {entity === 'news' ? (
              <Link className="ak-btn ak-btn--outline" href="/admin/content/news-categories">
                Категории
              </Link>
            ) : null}
            {entity === 'services' ? (
              <Link className="ak-btn ak-btn--outline" href="/admin/content/service-categories">
                Категории
              </Link>
            ) : null}
            {entity === 'news-categories' ? (
              <Link className="ak-btn ak-btn--outline" href="/admin/content/news">
                К новостям
              </Link>
            ) : null}
            {entity === 'service-categories' ? (
              <Link className="ak-btn ak-btn--outline" href="/admin/content/services">
                К услугам
              </Link>
            ) : null}
            <Link className="ak-btn ak-btn--primary" href={`${basePath}/new`}>
              {ADD_LABEL[entity]}
            </Link>
          </>
        }
      />
      <FlashToast ok={firstParam(sp.ok)} error={firstParam(sp.error)} okText="Готово." />
      {sectionHideable ? <SectionVisibilityControl section={entity as HideableSection} hidden={isSectionHidden(entity as HideableSection)} /> : null}
      <div className="ak-toolbar">
        <SearchInput label="Поиск" placeholder="Название или адрес" defaultValue={lp.q} />
      </div>
      {statusOptions.length > 0 ? (
        <FilterPanel basePath={basePath} params={sp} preserve={['sort', 'dir', 'pageSize', 'q']}>
          <SelectField name="status" label="Статус" placeholder="Все" options={statusOptions} defaultValue={status} />
        </FilterPanel>
      ) : null}
      <EntityTable entity={entity} rows={data.rows} basePath={basePath} params={sp} sort={lp.sort} dir={lp.dir} back={back} />
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath={basePath} params={sp} />
    </>
  );
}
