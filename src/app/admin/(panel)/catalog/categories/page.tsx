import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { parseProductListQuery, filterToParams } from '@/domain/catalog/products-list';
import { AppError } from '@/server/http/errors';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState, ErrorState, FlashToast, firstParam, PageHeader, SearchInput, TabPanel, Tabs, resolveTab, type SearchParams, type TabItem } from '@/ui/admin/kit';
import { categoryOps } from '../../_lib/category-ops';
import { categoryTreeOps, type TreeNode } from '../../_lib/category-tree-ops';
import { productListOps } from '../../_lib/product-list-ops';
import { productOps } from '../../_lib/product-ops';
import { ProductTable } from '../ProductTable';
import { BannersTab, CategoryCreateForm, CategoryHeader, DeleteCategory, ExtraTab, FiltersTab, SeoTab, SubcategoriesTab } from './CategoryCard';
import { CategoryTree } from './CategoryTree';
import './categories.css';

export const metadata: Metadata = { title: 'Категории' };
export const dynamic = 'force-dynamic';

const LIST = '/admin/catalog/categories';
const TAB_KEYS = ['products', 'subcategories', 'seo', 'filters', 'banners', 'extra'] as const;

export default async function AdminCategoriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  const canWrite = hasPermission(session, 'categories.write');
  const creating = firstParam(sp.new) === '1' && canWrite;
  const rawId = Number(firstParam(sp.id));
  const selectedId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  const card = selectedId === null ? null : categoryOps.get(session, selectedId);
  const tab = resolveTab(sp, TAB_KEYS);
  const parents = categoryOps.parentOptions(session, null);

  // дерево: корни и ветки до выбранной категории (остальное догружается при раскрытии)
  const roots = categoryTreeOps.children(session, null);
  const initialLevels: Record<string, TreeNode[]> = { root: roots.nodes };
  if (card) {
    for (const id of categoryTreeOps.path(session, card.row.id)) {
      const open = id !== card.row.id || card.childCount > 0;
      if (open) initialLevels[String(id)] = categoryTreeOps.children(session, id).nodes;
    }
  }

  const back = card ? `${LIST}?id=${card.row.id}${tab === TAB_KEYS[0] ? '' : `&tab=${tab}`}` : LIST;
  const parentFromUrl = Number(firstParam(sp.parent));

  return (
    <>
      <FlashToast ok={firstParam(sp.ok)} error={firstParam(sp.error)} okText={firstParam(sp.done) || 'Готово.'} />
      <PageHeader
        title="Категории"
        description="Структура каталога: дерево, видимость на сайте, карточка и настройки категории."
        actions={
          canWrite ? (
            <Link href={`${LIST}?new=1`} className="ak-btn ak-btn--primary" prefetch={false}>
              Добавить категорию
            </Link>
          ) : undefined
        }
      />
      <div className="cat-layout">
        <aside className="ak-card cat-layout__tree" aria-label="Структура категорий">
          <h2>Структура категорий</h2>
          <CategoryTree initialLevels={initialLevels} total={roots.total} selectedId={card?.row.id ?? null} tab={card && tab !== TAB_KEYS[0] ? tab : ''} canWrite={canWrite} parentChoices={parents} />
        </aside>
        <section className="cat-layout__card" aria-label="Карточка категории">
          {creating ? (
            <CategoryCreateForm parents={parents} parentId={Number.isInteger(parentFromUrl) && parentFromUrl > 0 ? parentFromUrl : null} />
          ) : selectedId !== null && !card ? (
            <div className="ak-card">
              <EmptyState title="Категория не найдена" icon="alert">
                <p>Возможно, она удалена. Выберите категорию в дереве.</p>
              </EmptyState>
            </div>
          ) : card ? (
            await CardPane({ session, card, tab, sp, canWrite, back, editing: firstParam(sp.edit) === '1', parents })
          ) : (
            <div className="ak-card">
              <EmptyState title="Выберите категорию" icon="folder">
                <p>Нажмите на категорию в дереве слева, чтобы открыть её карточку.</p>
              </EmptyState>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

async function CardPane({
  session,
  card,
  tab,
  sp,
  canWrite,
  back,
  editing,
  parents,
}: {
  session: Awaited<ReturnType<typeof requireStaffPage>>;
  card: NonNullable<ReturnType<typeof categoryOps.get>>;
  tab: string;
  sp: SearchParams;
  canWrite: boolean;
  back: string;
  editing: boolean;
  parents: ReturnType<typeof categoryOps.parentOptions>;
}) {
  const id = card.row.id;
  const items: TabItem[] = [
    { key: 'products', label: 'Товары', count: card.liveProductCount },
    { key: 'subcategories', label: 'Подкатегории', count: card.childCount },
    { key: 'seo', label: 'SEO' },
    { key: 'filters', label: 'Фильтры' },
    { key: 'banners', label: 'Баннеры' },
    { key: 'extra', label: 'Дополнительно' },
  ];
  const parentOptions = parents.filter((p) => p.id !== id);
  // выбор родителя в шапке: без самой категории и её потомков
  const headerParents = categoryOps.parentOptions(session, id);

  let panel: React.ReactNode;
  if (tab === 'products') {
    const base = parseProductListQuery(sp);
    const query = { ...base, categoryId: id };
    let result = null;
    let error: string | null = null;
    try {
      result = productListOps.list(session, query);
    } catch (e) {
      error = e instanceof AppError ? e.message : 'Не удалось загрузить товары. Обновите страницу.';
    }
    const canProductsWrite = hasPermission(session, 'products.write') || hasPermission(session, 'catalog.write');
    const canDelete = hasPermission(session, 'products.delete');
    panel = (
      <div className="cat-tab">
        <div className="ak-toolbar">
          <SearchInput label="Поиск товаров в категории" placeholder="Название, артикул или штрихкод" defaultValue={query.q ?? ''} />
          {canProductsWrite ? (
            <Link href="/admin/catalog/products/new" className="ak-btn ak-btn--outline">
              Добавить товар
            </Link>
          ) : null}
          <Link href={`/admin/catalog?${new URLSearchParams(filterToParams(query)).toString()}`} className="ak-btn ak-btn--outline">
            Открыть в общем списке
          </Link>
        </div>
        {result ? (
          <ProductTable
            result={result}
            query={query}
            params={sp}
            canWrite={canProductsWrite}
            canDelete={canDelete}
            back={back}
            options={productOps.formOptions(session)}
            basePath={LIST}
          />
        ) : (
          <div className="ak-card">
            <ErrorState title="Не удалось загрузить товары">
              <p>{error}</p>
            </ErrorState>
          </div>
        )}
      </div>
    );
  } else if (tab === 'subcategories') {
    const rows = categoryTreeOps.children(session, id).nodes;
    panel = <SubcategoriesTab card={card} rows={rows} canWrite={canWrite} parents={parentOptions} back={back} />;
  } else if (tab === 'seo') {
    panel = <SeoTab card={card} canWrite={canWrite} />;
  } else if (tab === 'filters') {
    panel = <FiltersTab card={card} rows={categoryOps.filters(session, id)} canWrite={canWrite} />;
  } else if (tab === 'banners') {
    const { links, choices } = categoryOps.banners(session, id);
    panel = <BannersTab card={card} links={links} choices={choices} canWrite={canWrite} />;
  } else {
    panel = <ExtraTab card={card} canWrite={canWrite} />;
  }

  return (
    <>
      <nav className="cat-crumbs" aria-label="Путь категории">
        {card.path.map((p, i) => (
          <span key={p.id}>
            {i > 0 ? ' › ' : ''}
            <Link href={`${LIST}?id=${p.id}`} prefetch={false}>
              {p.name}
            </Link>
          </span>
        ))}
      </nav>
      <CategoryHeader card={card} parents={headerParents} canWrite={canWrite} editing={editing} back={back} />
      <div className="ak-card cat-tabs">
        <Tabs items={items} active={tab} basePath={LIST} params={{ id: String(id) }} label="Разделы категории" />
        <TabPanel active={tab}>{panel}</TabPanel>
      </div>
      {canWrite ? <DeleteCategory card={card} /> : null}
    </>
  );
}
