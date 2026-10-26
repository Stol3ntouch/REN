import Link from 'next/link';
import type { TreeNode } from '../../_lib/category-tree-ops';
import type { CategoryCard as Card, CategoryFilterRow, ParentOption } from '../../_lib/category-ops';
import type { BannerChoice, BannerLinkRow } from '@/server/db/repositories/category-links';
import { pluralize } from '@/domain/catalog/format';
import { ConfirmButton, DataTable, FileUploader, FormField, SaveBar, SelectField, StatusBadge, TextAreaField, Toggle, UnsavedChangesGuard } from '@/ui/admin/kit';
import {
  addBannerAction,
  bulkSubcategoriesAction,
  createCategoryAction,
  deleteCategoryAction,
  removeBannerAction,
  saveExtraAction,
  saveFiltersAction,
  saveHeaderAction,
  saveSeoAction,
  toggleCategoryVisibleAction,
  updateBannerAction,
} from './actions';
import { CopyButton } from './CopyButton';
import { RelatedPicker } from './RelatedPicker';

const LIST = '/admin/catalog/categories';

const parentOptionsOf = (options: ParentOption[]) => options.map((o) => ({ value: String(o.id), label: o.label }));

/** Шапка карточки: изображение, название, URL (копировать), ID, описание, «Активная», позиция, родитель. «Редактировать категорию» открывает поля названия, slug и описания. */
export function CategoryHeader({ card, parents, canWrite, editing, back }: { card: Card; parents: ParentOption[]; canWrite: boolean; editing: boolean; back: string }) {
  const c = card.row;
  const url = `/catalog/${c.slug}`;
  const formId = 'cat-head-form';
  return (
    <form id={formId} action={saveHeaderAction} className="cat-head ak-card" aria-label="Карточка категории" encType="multipart/form-data">
      <input type="hidden" name="id" value={c.id} />
      <input type="hidden" name="back" value={back} />
      {canWrite ? <UnsavedChangesGuard formId={formId} /> : null}
      <div className="cat-head__image">
        {card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrl} alt={c.name} width={160} height={120} />
        ) : (
          <span className="cat-head__noimage">Нет изображения: на сайте — фото первого товара</span>
        )}
      </div>
      <div className="cat-head__main">
        {editing && canWrite ? (
          <>
            <FormField name="name" label="Название" defaultValue={c.name} required maxLength={120} />
            <FormField name="slug" label="URL (slug)" defaultValue={c.slug} maxLength={100} hint="Адрес страницы: /catalog/<slug>. При смене старый адрес перестаёт работать." />
            <TextAreaField name="description" label="Описание" defaultValue={c.description ?? ''} rows={3} maxLength={5000} />
          </>
        ) : (
          <>
            <input type="hidden" name="name" value={c.name} />
            <input type="hidden" name="slug" value={c.slug} />
            <input type="hidden" name="description" value={c.description ?? ''} />
            <h2 className="cat-head__title">{c.name}</h2>
            <p className="cat-head__url">
              URL: <a href={url}>{url}</a> <CopyButton text={url} label={`Скопировать адрес ${url}`} />
            </p>
            <p className="cat-head__id">ID: {c.id}</p>
            {c.description ? <p className="cat-head__desc">{c.description}</p> : null}
            {canWrite ? (
              <Link href={`${back}${back.includes('?') ? '&' : '?'}edit=1`} className="ak-btn ak-btn--outline" prefetch={false}>
                Редактировать категорию
              </Link>
            ) : null}
          </>
        )}
        <p className="cat-head__badges">
          {c.effectiveHidden ? <StatusBadge tone="warning">{c.hiddenByAdmin ? 'Скрыта на сайте' : c.active ? 'Скрыта через родителя' : 'Неактивна'}</StatusBadge> : <StatusBadge tone="success">Видна на сайте</StatusBadge>}
        </p>
      </div>
      <div className="cat-head__side">
        <Toggle name="active" checked={c.active} label="Активная" disabled={!canWrite} description="Неактивная категория недоступна на сайте вместе с подкатегориями" />
        <FormField name="sort" label="Позиция в меню" type="number" step={1} defaultValue={c.sort} disabled={!canWrite} />
        <SelectField name="parentId" label="Родительская категория" placeholder="Нет (корневая)" defaultValue={c.parentId === null ? '' : String(c.parentId)} options={parentOptionsOf(parents)} disabled={!canWrite} />
      </div>
      {canWrite ? (
        <div className="cat-head__upload">
          <FileUploader name="image" label="Изображение категории" value={card.imageUrl} alt={c.name} hint="JPG, PNG или WebP до 5 МБ. Рекомендуемый размер: 800×600" />
        </div>
      ) : null}
      {canWrite ? (
        <div className="cat-head__save">
          <SaveBar sticky={false} />
        </div>
      ) : null}
    </form>
  );
}

/** Создание категории (корневой или дочерней). */
export function CategoryCreateForm({ parents, parentId }: { parents: ParentOption[]; parentId: number | null }) {
  return (
    <form action={createCategoryAction} className="ak-card cat-create" aria-label="Новая категория">
      <h2>{parentId === null ? 'Новая категория' : 'Новая подкатегория'}</h2>
      <FormField name="name" label="Название" required maxLength={120} autoFocus />
      <SelectField name="parentId" label="Родительская категория" placeholder="Нет (корневая)" defaultValue={parentId === null ? '' : String(parentId)} options={parentOptionsOf(parents)} />
      <FormField name="slug" label="URL (slug)" maxLength={100} hint="Можно оставить пустым: адрес получится из названия." />
      <SaveBar saveLabel="Создать категорию" cancelHref={LIST} sticky={false} />
    </form>
  );
}

/** Вкладка «Подкатегории»: список с флажками, глазом, порядком, созданием и массовыми действиями. */
export function SubcategoriesTab({
  card,
  rows,
  canWrite,
  parents,
  back,
}: {
  card: Card;
  rows: TreeNode[];
  canWrite: boolean;
  parents: ParentOption[];
  back: string;
}) {
  const bulkId = 'sub-bulk';
  return (
    <div className="cat-tab">
      {canWrite ? (
        <p>
          <Link href={`${LIST}?new=1&parent=${card.row.id}`} className="ak-btn ak-btn--primary" prefetch={false}>
            Добавить подкатегорию
          </Link>
        </p>
      ) : null}
      <DataTable<TreeNode>
        caption="Подкатегории"
        basePath={LIST}
        params={{ id: String(card.row.id), tab: 'subcategories' }}
        rows={rows}
        rowKey={(r) => r.id}
        selectable={canWrite}
        bulkFormId={bulkId}
        rowLabel={(r) => `Выбрать «${r.name}»`}
        bulkActions={
          canWrite ? (
            <form id={bulkId} action={bulkSubcategoriesAction} className="cat-bulk-form" aria-label="Массовые действия с подкатегориями">
              <input type="hidden" name="back" value={back} />
              <div className="cat-bulk__actions">
                <button type="submit" name="bulk" value="hide" className="ak-btn ak-btn--outline">
                  Скрыть выбранные
                </button>
                <button type="submit" name="bulk" value="show" className="ak-btn ak-btn--outline">
                  Показать выбранные
                </button>
              </div>
              <div className="cat-bulk__move">
                <SelectField name="moveTo" label="Перенести выбранные в" placeholder="В корень (без родителя)" options={parentOptionsOf(parents.filter((p) => p.id !== card.row.id))} />
                <button type="submit" name="bulk" value="move" className="ak-btn ak-btn--primary">
                  Перенести
                </button>
              </div>
            </form>
          ) : undefined
        }
        empty={{ title: 'Подкатегорий нет', description: canWrite ? 'Добавьте подкатегорию кнопкой выше.' : undefined }}
        columns={[
          {
            key: 'name',
            header: 'Название',
            cell: (r) => (
              <Link href={`${LIST}?id=${r.id}`} prefetch={false}>
                {r.name}
              </Link>
            ),
          },
          { key: 'slug', header: 'URL', hideOnNarrow: true, cell: (r) => `/catalog/${r.slug}` },
          { key: 'count', header: 'Товаров', align: 'right', cell: (r) => r.productCount },
          {
            key: 'eye',
            header: 'На сайте',
            cell: (r) =>
              canWrite ? (
                <Toggle checked={!r.hidden} label={`Показана на сайте: ${r.name}`} hideLabel action={toggleCategoryVisibleAction.bind(null, r.id)} />
              ) : (
                <StatusBadge tone={r.hidden || r.effectiveHidden ? 'warning' : 'success'}>{r.hidden || r.effectiveHidden ? 'Скрыта' : 'Видна'}</StatusBadge>
              ),
          },
          {
            key: 'order',
            header: 'Порядок',
            hideOnNarrow: true,
            cell: (r) => (r.effectiveHidden && !r.hidden ? 'скрыта через родителя' : '—'),
          },
        ]}
      />
    </div>
  );
}

/** Вкладка «SEO». */
export function SeoTab({ card, canWrite }: { card: Card; canWrite: boolean }) {
  const c = card.row;
  return (
    <form action={saveSeoAction} className="ak-card cat-form" aria-label="SEO категории">
      <input type="hidden" name="id" value={c.id} />
      <fieldset disabled={!canWrite} className="cat-form__fields">
        <FormField name="seoTitle" label="SEO Title (если пусто — по шаблону из настроек SEO или название)" defaultValue={c.seoTitle ?? ''} maxLength={200} />
        <TextAreaField name="seoDescription" label="Meta Description" defaultValue={c.seoDescription ?? ''} maxLength={500} rows={3} />
        <FormField name="h1" label="H1 (если пусто — название категории)" defaultValue={c.h1 ?? ''} maxLength={200} />
        <FormField name="slug" label="URL (slug)" defaultValue={c.slug} maxLength={100} hint="Уникален среди категорий. При смене старый адрес перестаёт работать." />
        <FormField name="canonical" label="Canonical" defaultValue={c.canonical ?? ''} maxLength={500} placeholder="Пусто — адрес самой страницы" hint="Полный адрес http(s):// или путь, начинающийся с «/»." />
        <Toggle name="indexable" checked={c.indexable} label="Индексация" description="Выключено — на странице категории noindex, в sitemap её нет" />
        <TextAreaField name="seoText" label="SEO-текст (простой текст, абзацы — через пустую строку; до 5000 символов)" defaultValue={c.seoText ?? ''} rows={10} maxLength={5000} />
      </fieldset>
      {canWrite ? <SaveBar sticky={false} /> : <p className="ak-muted">Поля только для просмотра.</p>}
    </form>
  );
}

/** Вкладка «Фильтры»: показ и порядок общих фильтров каталога внутри этой категории. */
export function FiltersTab({ card, rows, canWrite }: { card: Card; rows: CategoryFilterRow[]; canWrite: boolean }) {
  if (rows.length === 0) {
    return <p className="ak-muted">Для этой категории нет настроенных фильтров. Общие фильтры настраиваются в разделе «Фильтры».</p>;
  }
  return (
    <form action={saveFiltersAction} className="ak-card cat-form" aria-label="Фильтры категории">
      <input type="hidden" name="id" value={card.row.id} />
      <p className="cat-hint">Общий порядок и состав задаются в разделе «Фильтры». Здесь можно скрыть фильтр в этой категории (и подкатегориях) или поставить его на своё место: чем меньше число, тем выше.</p>
      <div className="ak-tablewrap">
        <table className="ak-table">
          <caption className="visually-hidden">Фильтры категории</caption>
          <thead>
            <tr>
              <th scope="col">Фильтр</th>
              <th scope="col">Показывать</th>
              <th scope="col">Порядок</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.filterId}>
                <td>
                  {r.label}
                  <input type="hidden" name="filterId" value={r.filterId} />
                  {r.inheritedOff ? <small className="cat-hint"> скрыт настройкой родительской категории</small> : null}
                </td>
                <td>
                  <Toggle name={`enabled_${r.filterId}`} checked={r.enabled} label={`Показывать: ${r.label}`} hideLabel disabled={!canWrite} />
                </td>
                <td>
                  <input type="number" name={`sort_${r.filterId}`} step={1} defaultValue={r.sort ?? ''} placeholder={String(r.globalSort)} aria-label={`Порядок: ${r.label}`} disabled={!canWrite} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canWrite ? <SaveBar sticky={false} /> : null}
    </form>
  );
}

/** Вкладка «Баннеры»: привязка баннеров из раздела «Баннеры» (позиция «категория»). */
export function BannersTab({ card, links, choices, canWrite }: { card: Card; links: BannerLinkRow[]; choices: BannerChoice[]; canWrite: boolean }) {
  const id = card.row.id;
  return (
    <div className="cat-tab">
      {links.length === 0 ? <p className="ak-muted">Баннеры не привязаны. Показывается баннер ближайшей родительской категории, если он есть.</p> : null}
      {links.length > 0 ? (
        <ul className="cat-banners">
          {links.map((l) => (
            <li key={l.bannerId} className="ak-card">
              <form action={updateBannerAction} className="cat-banners__row">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="bannerId" value={l.bannerId} />
                <strong>
                  <Link href={`/admin/content/banners/${l.bannerId}`} prefetch={false}>
                    {l.title}
                  </Link>
                </strong>
                <StatusBadge tone={l.status === 'active' ? 'success' : 'neutral'}>{l.status === 'active' ? 'Активен' : 'Выключен'}</StatusBadge>
                <Toggle name="enabled" checked={l.enabled} label="Показывать в категории" disabled={!canWrite} />
                <FormField name="sort" label="Порядок" type="number" step={1} defaultValue={l.sort} disabled={!canWrite} />
                {canWrite ? (
                  <button type="submit" className="ak-btn ak-btn--outline">
                    Сохранить
                  </button>
                ) : null}
              </form>
              {canWrite ? (
                <form action={removeBannerAction}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="bannerId" value={l.bannerId} />
                  <ConfirmButton title="Убрать баннер из категории?" description="Баннер останется в разделе «Баннеры», исчезнет только привязка." confirmLabel="Убрать" className="ak-btn ak-btn--sm ak-btn--danger-outline">
                    Убрать связь
                  </ConfirmButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canWrite ? (
        choices.length > 0 ? (
          <form action={addBannerAction} className="ak-card cat-form" aria-label="Привязать баннер">
            <input type="hidden" name="id" value={id} />
            <SelectField name="bannerId" label="Привязать баннер" placeholder="Выберите баннер" options={choices.map((b) => ({ value: String(b.id), label: b.title }))} required />
            <button type="submit" className="ak-btn ak-btn--primary">
              Привязать
            </button>
          </form>
        ) : (
          <p className="cat-hint">
            Нет свободных баннеров позиции «категория». Создайте баннер в разделе <Link href="/admin/content/banners">«Баннеры»</Link>.
          </p>
        )
      ) : null}
    </div>
  );
}

/** Вкладка «Дополнительно»: показ, сортировка, связанные категории, служебные поля. */
export function ExtraTab({ card, canWrite }: { card: Card; canWrite: boolean }) {
  const c = card.row;
  return (
    <form action={saveExtraAction} id="cat-extra-form" className="cat-extra" aria-label="Дополнительные настройки категории">
      <input type="hidden" name="id" value={c.id} />
      {canWrite ? <UnsavedChangesGuard formId="cat-extra-form" /> : null}
      <fieldset disabled={!canWrite} className="cat-extra__grid">
        <section className="ak-card" aria-labelledby="cat-x-display">
          <h3 id="cat-x-display">Настройки отображения</h3>
          <Toggle name="showInMenu" checked={c.showInMenu} label="Показывать в меню" description="Меню и подвал сайта" />
          <Toggle name="showOnHome" checked={c.showOnHome} label="Показывать на главной странице" description="Плитки категорий на главной" />
          <Toggle name="showInCatalog" checked={c.showInCatalog} label="Показывать в каталоге" description="Дерево и списки категорий каталога" />
          <p className="cat-hint">Эти три настройки независимы друг от друга и от глаза видимости в дереве.</p>
        </section>
        <section className="ak-card" aria-labelledby="cat-x-sort">
          <h3 id="cat-x-sort">Настройки сортировки</h3>
          <FormField name="sort" label="Позиция сортировки" type="number" step={1} defaultValue={c.sort} />
          <FormField name="priority" label="Приоритет" type="number" step={1} defaultValue={c.priority} hint="Чем меньше значение, тем выше категория в списке." />
        </section>
        <section className="ak-card" aria-labelledby="cat-x-related">
          <h3 id="cat-x-related">Связанные категории</h3>
          <RelatedPicker selfId={c.id} initial={card.related.map((r) => ({ id: r.id, name: r.name }))} disabled={!canWrite} />
        </section>
        <section className="ak-card" aria-labelledby="cat-x-params">
          <h3 id="cat-x-params">Дополнительные параметры</h3>
          <FormField name="code" label="Код категории" defaultValue={c.code ?? ''} maxLength={64} hint="Уникальный системный код. Пусто — подставится cat_<ID>." />
          <FormField name="externalRef" label="Внешний ID" defaultValue={c.externalRef ?? ''} maxLength={100} />
          <TextAreaField name="adminComment" label="Комментарий администратора" defaultValue={c.adminComment ?? ''} rows={3} maxLength={2000} hint="Не публикуется на сайте." />
        </section>
      </fieldset>
      {canWrite ? <SaveBar /> : <p className="ak-muted">Поля только для просмотра.</p>}
    </form>
  );
}

/** Удаление категории (запрещено при товарах и подкатегориях — сервер вернёт подсказку). */
export function DeleteCategory({ card }: { card: Card }) {
  const blocked = card.childCount > 0 || card.productCount > 0;
  return (
    <form action={deleteCategoryAction} className="cat-delete">
      <input type="hidden" name="id" value={card.row.id} />
      {blocked ? (
        <p className="cat-hint">
          Удалить нельзя: в категории {card.productCount > 0 ? `${card.productCount} ${pluralize(card.productCount, ['товар', 'товара', 'товаров'])}` : ''}
          {card.productCount > 0 && card.childCount > 0 ? ' и ' : ''}
          {card.childCount > 0 ? `${card.childCount} ${pluralize(card.childCount, ['подкатегория', 'подкатегории', 'подкатегорий'])}` : ''}. Скройте категорию (глаз в дереве) или перенесите содержимое.
        </p>
      ) : (
        <ConfirmButton title={`Удалить категорию «${card.row.name}»?`} description="Категория пуста и будет удалена безвозвратно." confirmLabel="Удалить" className="ak-btn ak-btn--danger-outline">
          Удалить категорию
        </ConfirmButton>
      )}
    </form>
  );
}
