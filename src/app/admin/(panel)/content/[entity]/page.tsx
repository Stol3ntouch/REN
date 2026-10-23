import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listAdminItems, getSettingsRecord } from '@/domain/content/admin-view';
import { ENTITY_KEYS, ENTITY_LABELS, isEntityKey } from '@/domain/content/fields';
import { imageView } from '@/domain/content/images';
import { getShopInfo, DEFAULT_LOGO_URL } from '@/domain/content/settings';
import { MAX_SLIDES } from '@/server/db/repositories/slides';
import { requireStaffPage } from '@/ui/admin/guard';
import '@/ui/cart/admin-orders.css';
import { EmptyState } from '@/ui/states';
import { DeleteForm, EntityForm } from '../EntityForm';
import '../content-admin.css';

export const metadata: Metadata = { title: 'Контент и услуги' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ entity: string }>; searchParams: Promise<{ ok?: string; error?: string; edit?: string; new?: string }> };

export default async function ContentEntityPage({ params, searchParams }: Props) {
  await requireStaffPage('content.write'); // менеджер → редирект на обзор; обработчик сохранения проверяет право отдельно
  const { entity } = await params;
  if (!isEntityKey(entity)) notFound();
  const sp = await searchParams;
  const label = ENTITY_LABELS[entity];

  const tabs = (
    <ul className="adm-tabs" aria-label="Разделы контента">
      {ENTITY_KEYS.map((k) => (
        <li key={k}>
          <Link href={`/admin/content/${k}`} aria-current={k === entity ? 'page' : undefined}>
            {ENTITY_LABELS[k].title}
          </Link>
        </li>
      ))}
    </ul>
  );
  const flash = (
    <>
      {sp.ok ? (
        <p className="adm-flash" role="status">
          Сохранено.
        </p>
      ) : null}
      {sp.error ? (
        <p className="adm-flash adm-flash--error" role="alert">
          {sp.error}
        </p>
      ) : null}
    </>
  );

  if (entity === 'settings') {
    const shop = getShopInfo();
    const record = getSettingsRecord();
    return (
      <>
        <h1>Контент и услуги</h1>
        {tabs}
        <h2>{label.title}</h2>
        {flash}
        <EntityForm entity="settings" record={record} previews={{ logo: { src: shop.logoUrl, alt: 'Текущий логотип' } }} />
        {shop.logoUrl === DEFAULT_LOGO_URL ? <p className="adm-hint">Сейчас используется логотип по умолчанию.</p> : null}
      </>
    );
  }

  const items = listAdminItems(entity);
  const editId = sp.edit && /^\d+$/.test(sp.edit) ? Number(sp.edit) : null;
  const editing = editId === null ? undefined : items.find((i) => i.id === editId);
  const canCreate = entity !== 'pages' && !(entity === 'slides' && items.length >= MAX_SLIDES);
  const showNew = canCreate && (sp.new === '1' || (items.length === 0 && !editing));

  const previewsFor = (record: Record<string, unknown>) => {
    const img = imageView(record as { imagePath: string | null; imageVariants: string | null; imageAlt: string | null }, 'thumb', 'Загруженное изображение');
    return { image: img ? { src: img.src, alt: img.alt } : null };
  };

  return (
    <>
      <h1>Контент и услуги</h1>
      {tabs}
      <h2>{label.title}</h2>
      <p className="adm-hint">{label.hint}</p>
      {flash}

      {items.length === 0 ? (
        <EmptyState title="Пока ничего нет">
          <p>Добавьте первую запись ниже. Пустые разделы на сайте не показываются.</p>
        </EmptyState>
      ) : (
        <ul className="adm-list">
          {items.map((i) => (
            <li key={i.id}>
              <span>
                {i.title}
                <span className="adm-list__note">{i.note}</span>
              </span>
              <span className="adm-actions">
                <Link className="button button--outline" href={`/admin/content/${entity}?edit=${i.id}`}>
                  Изменить
                </Link>
                {entity !== 'pages' ? <DeleteForm entity={entity} id={i.id} /> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canCreate && !showNew ? (
        <p>
          <Link className="button" href={`/admin/content/${entity}?new=1`}>
            Добавить
          </Link>
        </p>
      ) : null}
      {entity === 'slides' && items.length >= MAX_SLIDES ? <p className="adm-hint">Слайдов уже {MAX_SLIDES} — чтобы добавить новый, удалите один из существующих.</p> : null}

      {editing ? (
        <>
          <h3>Изменить: {editing.title}</h3>
          <EntityForm key={editing.id} entity={entity} id={editing.id} record={editing.record} previews={previewsFor(editing.record)} />
        </>
      ) : null}
      {showNew && !editing ? (
        <>
          <h3>Новая запись</h3>
          <EntityForm entity={entity} submitLabel="Создать" />
        </>
      ) : null}
    </>
  );
}
