import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ENTITY_LABELS, isListEntityKey, type ListEntityKey } from '@/domain/content/fields';
import { imageView } from '@/domain/content/images';
import { contentStatus, pagePath } from '@/domain/content/queries';
import { getDb } from '@/server/db/connection';
import { bannersRepo } from '@/server/db/repositories/banners';
import { companyReviewsRepo } from '@/server/db/repositories/company-reviews';
import { listAuthorOptions, newsRepo } from '@/server/db/repositories/news';
import { newsCategoriesRepo } from '@/server/db/repositories/news-categories';
import { pagesRepo, pageVersionsRepo } from '@/server/db/repositories/pages';
import { promotionsRepo } from '@/server/db/repositories/promotions';
import { serviceCategoriesRepo } from '@/server/db/repositories/service-categories';
import { servicesRepo } from '@/server/db/repositories/services';
import { requireStaffPage } from '@/ui/admin/guard';
import { PageHeader } from '@/ui/admin/kit/PageHeader';
import { FlashToast } from '@/ui/admin/kit/Toaster';
import { firstParam, type SearchParams } from '@/ui/admin/kit/url';
import { previewLinkAction, rollbackPageAction } from '../../actions';
import { ContentForm, type FieldOptions, type FormPreviews } from '../../ContentForm';
import '../../content-admin.css';

export const metadata: Metadata = { title: 'Контент' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ entity: string; id: string }>; searchParams: Promise<SearchParams> };

const DATETIME = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });

type Loaded = { record: Record<string, unknown>; title: string };

function load(entity: ListEntityKey, id: number): Loaded | null {
  const db = getDb();
  const now = Date.now();
  switch (entity) {
    case 'pages': {
      const r = pagesRepo.get(db, id);
      return r ? { record: { ...r, status: contentStatus(r, now) }, title: r.title } : null;
    }
    case 'banners': {
      const r = bannersRepo.get(db, id);
      return r ? { record: { ...r, categoryIds: bannersRepo.listCategories(db, id).map((c) => c.categoryId) }, title: r.title } : null;
    }
    case 'news': {
      const r = newsRepo.get(db, id);
      return r ? { record: { ...r, status: contentStatus(r, now) }, title: r.title } : null;
    }
    case 'news-categories': {
      const r = newsCategoriesRepo.get(db, id);
      return r ? { record: { ...r }, title: r.name } : null;
    }
    case 'services': {
      const r = servicesRepo.get(db, id);
      return r ? { record: { ...r }, title: r.title } : null;
    }
    case 'service-categories': {
      const r = serviceCategoriesRepo.get(db, id);
      return r ? { record: { ...r }, title: r.name } : null;
    }
    case 'promotions': {
      const r = promotionsRepo.get(db, id);
      return r ? { record: { ...r, ...promotionsRepo.targets(db, id) }, title: r.title } : null;
    }
    case 'reviews': {
      const r = companyReviewsRepo.get(db, id);
      return r ? { record: { ...r }, title: r.authorName } : null;
    }
  }
}

const NEW_DEFAULTS: Partial<Record<ListEntityKey, Record<string, unknown>>> = {
  banners: { position: 'home_hero', status: 'active' },
  pages: { status: 'draft' },
  news: { status: 'draft' },
  promotions: { discountType: 'none', priority: 0 },
};

/** Форма создания (id = new) и правки записи раздела «Контент». */
export default async function ContentEditPage({ params, searchParams }: Props) {
  await requireStaffPage('content.write');
  const { entity, id: idRaw } = await params;
  if (!isListEntityKey(entity)) notFound();
  const sp = await searchParams;
  const isNew = idRaw === 'new';
  if (!isNew && !/^\d+$/.test(idRaw)) notFound();
  const id = isNew ? undefined : Number(idRaw);
  const loaded = id === undefined ? null : load(entity, id);
  if (id !== undefined && !loaded) notFound();

  const db = getDb();
  const record = loaded?.record ?? NEW_DEFAULTS[entity] ?? {};
  const options: FieldOptions = {
    categoryId: entity === 'news' ? newsCategoriesRepo.list(db).map((c) => ({ value: String(c.id), label: c.name })) : serviceCategoriesRepo.list(db).map((c) => ({ value: String(c.id), label: c.name })),
    authorStaffId: listAuthorOptions(db).map((a) => ({ value: String(a.id), label: a.name })),
    categoryIds: promotionsRepo.categoryOptions(db).map((c) => ({ value: String(c.id), label: c.label })),
  };
  const previews: FormPreviews = {};
  if (loaded) {
    const r = loaded.record as { imagePath?: string | null; imageVariants?: string | null; imageAlt?: string | null; alt?: string | null; mobileImagePath?: string | null; mobileImageVariants?: string | null };
    const img = imageView({ imagePath: r.imagePath ?? null, imageVariants: r.imageVariants ?? null, imageAlt: r.imageAlt ?? r.alt ?? null }, 'thumb', 'Загруженное изображение');
    previews.image = img ? { src: img.src, alt: img.alt } : null;
    const mob = imageView({ imagePath: r.mobileImagePath ?? null, imageVariants: r.mobileImageVariants ?? null, imageAlt: r.alt ?? null }, 'thumb', 'Изображение для телефона');
    previews.mobileImage = mob ? { src: mob.src, alt: mob.alt } : null;
  }
  const products = entity === 'promotions' && id !== undefined ? promotionsRepo.productsByIds(db, (record.productIds as number[] | undefined) ?? []) : [];

  const label = ENTITY_LABELS[entity];
  const preview = firstParam(sp.preview);
  const previewable = entity === 'pages' || entity === 'news';
  const versions = entity === 'pages' && id !== undefined ? pageVersionsRepo.list(db, id) : [];
  const publicHref = loaded && entity === 'pages' ? pagePath(loaded.record as { key: string | null; slug: string }) : null;

  const extra = (
    <>
      {previewable && id !== undefined ? (
        <section className="ak-card" aria-labelledby="preview-h">
          <h2 id="preview-h">Предпросмотр</h2>
          <p className="ak-field__hint">Одноразовая ссылка действует 30 минут и открывается только вошедшему сотруднику. Сначала сохраните изменения.</p>
          {preview.startsWith('/admin/preview/') ? (
            <p>
              <a className="ak-btn ak-btn--primary" href={preview} target="_blank" rel="noopener noreferrer">
                Открыть предпросмотр
              </a>
            </p>
          ) : null}
        </section>
      ) : null}
      {versions.length > 0 ? (
        <section className="ak-card" aria-labelledby="versions-h">
          <h2 id="versions-h">Версии страницы</h2>
          <p className="ak-field__hint">Перед каждой правкой содержимого хранится прежняя версия (последние 20). Откат сам сохраняет текущее состояние как версию.</p>
          <ul className="ak-versions">
            {versions.map((v) => (
              <li key={v.id}>
                {DATETIME.format(new Date(v.createdAt))} — {v.title}{' '}
                <button type="submit" form={`rollback-${v.id}`} className="ak-btn ak-btn--sm ak-btn--outline">
                  Вернуть эту версию
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title={id === undefined ? `Создание: ${label.singular}` : loaded!.title}
        description={label.hint}
        actions={
          <>
            {publicHref ? (
              <Link className="ak-btn ak-btn--outline" href={publicHref} target="_blank">
                Открыть на сайте
              </Link>
            ) : null}
            {previewable && id !== undefined ? (
              <form action={previewLinkAction}>
                <input type="hidden" name="entity" value={entity} />
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="ak-btn ak-btn--outline">
                  Ссылка на предпросмотр
                </button>
              </form>
            ) : null}
          </>
        }
      />
      <FlashToast ok={firstParam(sp.ok)} error={firstParam(sp.error)} okText="Сохранено." />
      <ContentForm entity={entity} id={id} record={record} options={options} previews={previews} products={products} cancelHref={`/admin/content/${entity}`} extra={extra} />
      {versions.map((v) => (
        <form key={v.id} id={`rollback-${v.id}`} action={rollbackPageAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={v.id} />
        </form>
      ))}
    </>
  );
}
