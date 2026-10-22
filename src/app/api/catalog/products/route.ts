import { NextResponse } from 'next/server';
import { parseCatalogParams } from '@/domain/catalog/params';
import { searchProducts } from '@/domain/catalog/search';

/**
 * GET /api/catalog/products?category=<slug>&q=&sort=&page=&min=&max=&stock=1&a<id>=<значение>
 * → { items: ProductCard[], total, page, pageSize, hasMore } — для «Показать ещё».
 * Те же параметры, что у страниц каталога; любой мусор приводится к безопасным значениям.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = params.get('category')?.trim();
  const query = parseCatalogParams(params, slug ? { categorySlug: slug.slice(0, 200) } : {});
  try {
    const result = await searchProducts(query);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: { message: 'Не удалось загрузить товары' } }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
