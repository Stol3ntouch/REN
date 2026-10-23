import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCategoryBreadcrumbs, getCategoryBySlug, getCategoryTree, getSiblingCategories } from '@/domain/catalog/categories';
import { getFacets } from '@/domain/catalog/facets';
import { buildCatalogQueryString, parseCatalogParams, type RawParams } from '@/domain/catalog/params';
import { searchProducts } from '@/domain/catalog/search';
import type { CategoryNode } from '@/domain/catalog/types';
import { Breadcrumbs } from '@/ui/catalog/Breadcrumbs';
import { CatalogListing } from '@/ui/catalog/CatalogListing';
import { CategoryTiles } from '@/ui/catalog/CategoryTiles';
import { CategoryTree } from '@/ui/catalog/CategoryTree';
import { ResponsiveDetails } from '@/ui/catalog/ResponsiveDetails';
import { EmptyState } from '@/ui/states';
import '@/ui/catalog/catalog.css';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Страницы с фильтрами, сортировкой и поиском — дубли категории, в индекс не нужны. */
function isFiltered(raw: RawParams): boolean {
  const q = parseCatalogParams(raw);
  return (
    Object.keys(q.filters).length > 0 ||
    q.text !== undefined ||
    q.priceMin !== undefined ||
    q.priceMax !== undefined ||
    q.inStockOnly === true ||
    q.sort !== 'name'
  );
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: 'Категория не найдена', robots: { index: false } };
  const sp = await searchParams;
  return {
    title: category.seoTitle ?? category.name,
    description: category.seoDescription ?? undefined,
    robots: isFiltered(sp) ? { index: false, follow: true } : undefined,
  };
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

  const [facets, tree, crumbs, siblings] = await Promise.all([
    getFacets(category.id, { text: query.text, filters: query.filters, priceMin: query.priceMin, priceMax: query.priceMax, inStockOnly: query.inStockOnly }),
    getCategoryTree(),
    getCategoryBreadcrumbs(slug),
    getSiblingCategories(slug),
  ]);
  const node = findNode(tree, slug);
  const seoParagraphs = (category.seoText ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      <Breadcrumbs items={[{ name: 'Каталог', href: '/catalog' }, ...crumbs.slice(0, -1)]} current={category.name} />
      <h1>{category.h1 ?? category.name}</h1>

      {node && node.children.length > 0 ? (
        <CategoryTiles nodes={node.children} label="Подкатегории" />
      ) : null}

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

      {seoParagraphs.length > 0 ? (
        <section className="seo-text" aria-label={`О категории «${category.name}»`}>
          {seoParagraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ) : null}
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
