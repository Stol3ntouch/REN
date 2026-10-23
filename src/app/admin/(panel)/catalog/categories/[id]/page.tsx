import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { requireStaffPage } from '@/ui/admin/guard';
import { CATALOG_NAV, Flash, str, SubNav } from '../../../_lib/ui';
import { categorySeoOps } from '../../category-seo-ops';
import { saveCategorySeoAction } from '../actions';

export const metadata: Metadata = { title: 'SEO категории' };
export const dynamic = 'force-dynamic';

export default async function AdminCategorySeoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('catalog.read');
  const { id: rawId } = await params;
  const sp = await searchParams;
  const id = Number(rawId);
  const category = Number.isInteger(id) ? categorySeoOps.get(session, id) : null;
  if (!category) notFound();
  const canEdit = hasPermission(session.role, 'catalog.write');

  return (
    <>
      <h1>{category.name}</h1>
      <SubNav items={CATALOG_NAV} current="/admin/catalog/categories" />
      <p>
        <Link href="/admin/catalog/categories">← К списку категорий</Link> · <Link href={`/catalog/${category.slug}`}>Открыть на сайте</Link>
      </p>
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      {!canEdit ? <p className="ops-readonly">Поля только для просмотра: правит администратор.</p> : null}
      <form action={saveCategorySeoAction} className="adm-card" aria-label="SEO категории">
        <input type="hidden" name="id" value={category.id} />
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--space-3)' }}>
          <div className="adm-field">
            <label htmlFor="cs-title">Title (если пусто — название категории)</label>
            <input id="cs-title" name="seoTitle" maxLength={200} defaultValue={category.seoTitle ?? ''} />
          </div>
          <div className="adm-field">
            <label htmlFor="cs-desc">Description</label>
            <textarea id="cs-desc" name="seoDescription" className="ops-textarea" maxLength={500} defaultValue={category.seoDescription ?? ''} />
          </div>
          <div className="adm-field">
            <label htmlFor="cs-h1">H1 (если пусто — название категории)</label>
            <input id="cs-h1" name="h1" maxLength={200} defaultValue={category.h1 ?? ''} />
          </div>
          <div className="adm-field">
            <label htmlFor="cs-text">SEO-текст (простой текст, абзацы — через пустую строку; до 5000 символов)</label>
            <textarea id="cs-text" name="seoText" className="ops-textarea" rows={12} maxLength={5000} defaultValue={category.seoText ?? ''} />
          </div>
        </fieldset>
        {canEdit ? (
          <div className="adm-inline">
            <button type="submit" className="button">
              Сохранить
            </button>
          </div>
        ) : null}
      </form>
    </>
  );
}
