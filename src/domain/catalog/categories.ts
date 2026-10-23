import { visibleProductSql } from '@/server/db/repositories/products';
import { getDb, type Db } from '@/server/db/connection';
import { categoriesRepo, type CategoryRow } from '@/server/db/repositories/categories';
import { listCategoryRows } from './category-rows';
import type { Breadcrumb, CategoryInfo, CategoryNode } from './types';

export function categoryHref(slug: string): string {
  return `/catalog/${slug}`;
}

export function toCategoryInfo(c: CategoryRow): CategoryInfo {
  return { id: c.id, slug: c.slug, name: c.name, h1: c.h1, seoTitle: c.seoTitle, seoDescription: c.seoDescription, seoText: c.seoText, parentId: c.parentId };
}

/** SEO-текст категории → абзацы (разделитель — пустая строка). Пустой текст — пустой массив. */
export function splitSeoText(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** H1 страницы категории: заданный вручную, иначе название. */
export function categoryHeading(c: { name: string; h1: string | null }): string {
  return c.h1?.trim() || c.name;
}

/**
 * Дерево категорий (порядок sort, затем id). productCount — опубликованные товары
 * категории вместе со всеми подкатегориями.
 */
export async function getCategoryTree(opts: { db?: Db } = {}): Promise<CategoryNode[]> {
  const db = opts.db ?? getDb();
  const rows = listCategoryRows(db);
  const direct = new Map<number, number>(
    (db.prepare(`SELECT p.category_id AS id, COUNT(*) AS n FROM products p WHERE ${visibleProductSql('p')} GROUP BY p.category_id`).all() as { id: number; n: number }[]).map((r) => [r.id, r.n]),
  );

  const nodes = new Map<number, CategoryNode>(
    rows.map((r) => [r.id, { id: r.id, slug: r.slug, name: r.name, parentId: r.parentId, productCount: direct.get(r.id) ?? 0, children: [] }]),
  );
  const roots: CategoryNode[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id) as CategoryNode;
    const parent = r.parentId === null ? undefined : nodes.get(r.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const total = (n: CategoryNode): number => {
    n.productCount += n.children.reduce((sum, c) => sum + total(c), 0);
    return n.productCount;
  };
  roots.forEach(total);
  return roots;
}

/** Путь от корня до категории включительно (без «Главной» и «Каталога»). Неизвестный slug — пусто. */
export async function getCategoryBreadcrumbs(slug: string, opts: { db?: Db } = {}): Promise<Breadcrumb[]> {
  const db = opts.db ?? getDb();
  const rows = listCategoryRows(db);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const start = rows.find((r) => r.slug === slug);
  if (!start) return [];
  const chain: Breadcrumb[] = [];
  const seen = new Set<number>();
  for (let cur: CategoryRow | undefined = start; cur && !seen.has(cur.id); cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) {
    seen.add(cur.id);
    chain.unshift({ name: cur.name, href: categoryHref(cur.slug) });
  }
  return chain;
}

export async function getCategoryBySlug(slug: string, opts: { db?: Db } = {}): Promise<CategoryInfo | null> {
  const c = categoriesRepo.findBySlug(opts.db ?? getDb(), slug);
  return c ? toCategoryInfo(c) : null;
}

/** Соседние категории (тот же родитель, без самой категории); у корневой — другие корневые. */
export async function getSiblingCategories(slug: string, opts: { db?: Db } = {}): Promise<CategoryNode[]> {
  const tree = await getCategoryTree(opts);
  const flat: CategoryNode[] = [];
  const walk = (list: CategoryNode[]) => list.forEach((n) => (flat.push(n), walk(n.children)));
  walk(tree);
  const me = flat.find((n) => n.slug === slug);
  if (!me) return [];
  const siblings = me.parentId === null ? tree : (flat.find((n) => n.id === me.parentId)?.children ?? []);
  return siblings.filter((n) => n.id !== me.id);
}
