import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { categoryHeading, getCategoryBreadcrumbs, getCategoryBySlug, getCategoryTree, getSiblingCategories } from '@/domain/catalog/categories';
import { facetContext, getFacets } from '@/domain/catalog/facets';
import { buildCatalogQueryString, parseCatalogParams } from '@/domain/catalog/params';
import { searchProducts } from '@/domain/catalog/search';
import { getCategoryBanners } from '@/domain/content/queries';
import { getDb } from '@/server/db/connection';
import { categoryLinksRepo } from '@/server/db/repositories/category-links';
import { BannerBlock } from '@/ui/home/BannerBlock';
import { CategoryRelated } from '@/ui/catalog/CategoryRelated';
import type { CategoryNode } from '@/domain/catalog/types';
import { breadcrumbJsonLd } from '@/domain/seo/jsonld';
import { categoryMetadata, loadCategorySeoContext } from '@/domain/seo/metadata';
import { resolveSiteUrl } from '@/domain/seo/site-url';
import { JsonLd } from '@/ui/seo/JsonLd';
import { Breadcrumbs } from '@/ui/catalog/Breadcrumbs';
import { CatalogListing } from '@/ui/catalog/CatalogListing';
import { CategorySeoText } from '@/ui/catalog/CategorySeoText';
import { CategoryTiles } from '@/ui/catalog/CategoryTiles';
import { CategoryTree } from '@/ui/catalog/CategoryTree';
import { ResponsiveDetails } from '@/ui/catalog/ResponsiveDetails';
import { EmptyState } from '@/ui/states';
import '@/ui/catalog/catalog.css';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: 'Категория не найдена', robots: { index: false } };
  return categoryMetadata(category, await searchParams, loadCategorySeoContext(category.id));
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const sp = await searchParams;
  const query = parseCatalogParams(sp, { categorySlug: slug });
  const basePath = `/catalog/${slug}`;
  const result = await searchProducts(query);

  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (query.page > lastPage) {
    const qs = buildCatalogQueryString(query, { page: lastPage });
    redirect(qs === '' ? basePath : `${basePath}?${qs}`);
  }

  const [facets, tree, fullTree, crumbs, siblings] = await Promise.all([
    getFacets(category.id, facetContext(query)),
    getCategoryTree(),
    getCategoryTree({ all: true }),
    getCategoryBreadcrumbs(slug),
    getSiblingCategories(slug),
  ]);
  // сама категория ищется в полном дереве (она могла быть убрана из дерева каталога флагом); плитки подкатегорий — только «показывать в каталоге»
  const node = findNode(fullTree, slug);
  const subcategories = node?.children.filter((c) => c.showInCatalog) ?? [];
  const banners = getCategoryBanners(category.id);
  const related = categoryLinksRepo.listRelatedVisible(getDb(), category.id);

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'Каталог', href: '/catalog' }, ...crumbs], resolveSiteUrl())} />
      <Breadcrumbs items={[{ name: 'Каталог', href: '/catalog' }, ...crumbs.slice(0, -1)]} current={category.name} />
      <h1>{categoryHeading(category)}</h1>

      <BannerBlock banners={banners} label="Баннеры категории" />

      {subcategories.length > 0 ? <CategoryTiles nodes={subcategories} label="Подкатегории" /> : null}

      <CatalogListing
        basePath={basePath}
        query={query}
        result={result}
        facets={facets}
        apiCategory={slug}
        sidebar={
          <ResponsiveDetails className="catalog-tree-wrap" summary="Категории">
            <CategoryTree tree={tree} activeSlug={slug} />
          </ResponsiveDetails>
        }
        emptyContent={
          <EmptyState title="Здесь пока нет товаров">
            {siblings.length > 0 ? (
              <>
                <p>Загляните в соседние категории:</p>
                <ul className="empty-links">
                  {siblings.slice(0, 12).map((s) => (
                    <li key={s.id}>
                      <Link href={`/catalog/${s.slug}`}>{s.name}</Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p>
              <Link href="/catalog">Весь каталог</Link>
            </p>
          </EmptyState>
        }
      />

      <CategorySeoText name={category.name} text={category.seoText} />
      <CategoryRelated items={related} />
    </>
  );
}

function findNode(tree: CategoryNode[], slug: string): CategoryNode | undefined {
  for (const n of tree) {
    if (n.slug === slug) return n;
    const child: CategoryNode | undefined = findNode(n.children, slug);
    if (child) return child;
  }
  return undefined;
}
