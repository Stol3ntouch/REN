import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { formatRub } from '@/domain/pricing/format';
import { requireStaffPage } from '@/ui/admin/guard';
import { catalogOps } from '../../_lib/catalog-ops';
import { Flash, CATALOG_NAV, str, SubNav } from '../../_lib/ui';
import { hideProductsAction, saveProductAction, showProductsAction, unlockFieldsAction } from '../actions';

export const metadata: Metadata = { title: 'Карточка товара' };
export const dynamic = 'force-dynamic';

const rubInput = (kopecks: number | null) => (kopecks === null ? '' : kopecks % 100 === 0 ? String(kopecks / 100) : (kopecks / 100).toFixed(2).replace('.', ','));

const LOCK_LABELS: Record<string, string> = {
  price: 'цена',
  discount_price: 'скидочная цена',
  published: 'публикация',
  featured: '«рекомендуем»',
  description: 'описание',
  seo_title: 'SEO-заголовок',
  seo_description: 'SEO-описание',
  name: 'название',
  sku: 'артикул',
  category: 'категория',
  in_stock: 'наличие',
  attributes: 'характеристики',
  images: 'фото',
};

export default async function AdminProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('catalog.read');
  const { id: rawId } = await params;
  const sp = await searchParams;
  const id = Number(rawId);
  const found = Number.isInteger(id) ? catalogOps.get(session, id) : null;
  if (!found) notFound();
  const { product: p, manualEdit } = found;
  const canWrite = hasPermission(session.role, 'catalog.write');
  const canEdit = manualEdit && canWrite;

  return (
    <>
      <h1>{p.name}</h1>
      <SubNav items={CATALOG_NAV} current="/admin/catalog" />
      <p>
        <Link href="/admin/catalog">← К списку товаров</Link>
      </p>
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />
      <section className="adm-card" aria-labelledby="vis-h">
        <h2 id="vis-h">Видимость на сайте</h2>
        <p>
          {p.hidden ? <strong>Скрыт администратором: не виден на сайте, в поиске и в карте сайта.</strong> : p.published ? 'Виден на сайте.' : 'Не опубликован (снят с публикации).'}
        </p>
        {canWrite ? (
          <form action={p.hidden ? showProductsAction : hideProductsAction}>
            <input type="hidden" name="one" value={p.id} />
            <input type="hidden" name="back" value={`/admin/catalog/${p.id}`} />
            <button type="submit" className={p.hidden ? 'button' : 'button button--outline'}>
              {p.hidden ? 'Показать' : 'Скрыть'}
            </button>
          </form>
        ) : null}
      </section>
      <dl className="adm-card">
        <div>
          <dt>Артикул</dt>
          <dd>{p.sku ?? '—'}</dd>
        </div>
        <div>
          <dt>Категория</dt>
          <dd>{p.categoryName}</dd>
        </div>
        <div>
          <dt>Наличие (из импорта/1С)</dt>
          <dd>{p.inStock ? 'в наличии' : 'нет в наличии'}</dd>
        </div>
        <div>
          <dt>Источник</dt>
          <dd>{p.source}</dd>
        </div>
      </dl>

      {!canEdit ? (
        <p className="ops-readonly">
          {!hasPermission(session.role, 'catalog.write')
            ? 'Поля только для просмотра: правит администратор.'
            : 'Поля только для чтения: источник данных — импорт YML / 1С. Администратор может включить ручное редактирование в настройках.'}
        </p>
      ) : null}

      <form action={saveProductAction} className="adm-card" aria-label="Поля товара">
        <input type="hidden" name="id" value={p.id} />
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--space-3)' }}>
          <div className="adm-filters">
            <div className="adm-field">
              <label htmlFor="pr-price">Цена, ₽</label>
              <input id="pr-price" name="price" required inputMode="decimal" defaultValue={rubInput(p.priceKopecks)} />
            </div>
            <div className="adm-field">
              <label htmlFor="pr-disc">Скидочная цена, ₽ (меньше обычной)</label>
              <input id="pr-disc" name="discountPrice" inputMode="decimal" defaultValue={rubInput(p.discountPriceKopecks)} />
            </div>
          </div>
          <label>
            <input type="checkbox" name="published" defaultChecked={p.published} /> Опубликован на сайте
          </label>
          <label>
            <input type="checkbox" name="featured" defaultChecked={p.featured} /> Рекомендуемый товар
          </label>
          <div className="adm-field">
            <label htmlFor="pr-desc">Описание (безопасный HTML: абзацы, списки, выделение)</label>
            <textarea id="pr-desc" name="description" className="ops-textarea" defaultValue={p.description ?? ''} maxLength={20000} />
          </div>
          <div className="adm-field">
            <label htmlFor="pr-st">SEO-заголовок</label>
            <input id="pr-st" name="seoTitle" maxLength={200} defaultValue={p.seoTitle ?? ''} />
          </div>
          <div className="adm-field">
            <label htmlFor="pr-sd">SEO-описание</label>
            <textarea id="pr-sd" name="seoDescription" className="ops-textarea" maxLength={500} defaultValue={p.seoDescription ?? ''} />
          </div>
        </fieldset>
        {canEdit ? (
          <div className="adm-inline">
            <button type="submit" className="button">
              Сохранить
            </button>
          </div>
        ) : (
          <p className="ops-muted">
            Цена сейчас: {formatRub(p.priceKopecks)}
            {p.discountPriceKopecks !== null ? `, скидочная ${formatRub(p.discountPriceKopecks)}` : ''}
          </p>
        )}
      </form>

      <section className="adm-card" aria-labelledby="lock-h">
        <h2 id="lock-h">Закреплено за ручной правкой</h2>
        {p.lockedFields.length === 0 ? (
          <p className="ops-muted">Ничего не закреплено: импорт может обновить любое поле.</p>
        ) : canEdit ? (
          <form action={unlockFieldsAction}>
            <input type="hidden" name="id" value={p.id} />
            <p className="ops-muted">Эти поля импорт не перезаписывает. Отметьте те, что вернуть под управление импорта.</p>
            {p.lockedFields.map((f) => (
              <label key={f} style={{ display: 'block' }}>
                <input type="checkbox" name="fields" value={f} /> {LOCK_LABELS[f] ?? f}
              </label>
            ))}
            <div className="adm-inline">
              <button type="submit" className="button button--outline">
                Вернуть импорту
              </button>
            </div>
          </form>
        ) : (
          <ul>
            {p.lockedFields.map((f) => (
              <li key={f}>{LOCK_LABELS[f] ?? f}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
