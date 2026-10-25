import type { ProductPage } from '@/domain/catalog/types';
import { plainExcerpt } from '@/domain/content/seo';
import { absoluteUrl } from './site-url';

type Json = Record<string, unknown>;

const SCHEMA_AVAILABILITY = {
  in_stock: 'https://schema.org/InStock',
  out_of_stock: 'https://schema.org/OutOfStock',
  preorder: 'https://schema.org/PreOrder',
  discontinued: 'https://schema.org/Discontinued',
} as const;

/** Product: цена и наличие — по данным товара; aggregateRating — только при опубликованных отзывах (average и count из getProductRating). */
export function productJsonLd(
  product: Pick<ProductPage, 'name' | 'slug' | 'sku' | 'descriptionHtml' | 'unitKopecks' | 'inStock' | 'images'> & { availability?: ProductPage['availability'] },
  rating: { average: number | null; count: number },
  siteUrl: string,
  opts: { withOffers?: boolean; currency?: string } = {},
): Json & { offers?: Json; aggregateRating?: Json; image?: string[] } {
  const description = plainExcerpt(product.descriptionHtml?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '), 500);
  const images = product.images.map((i) => (i.remote ? i.src : absoluteUrl(siteUrl, i.src)));
  const ld: Json & { offers?: Json; aggregateRating?: Json; image?: string[] } = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url: absoluteUrl(siteUrl, `/product/${product.slug}`),
  };
  if (product.sku) ld.sku = product.sku;
  if (description) ld.description = description;
  if (images.length > 0) ld.image = images;
  if (product.unitKopecks > 0 && opts.withOffers !== false) {
    ld.offers = {
      '@type': 'Offer',
      price: (product.unitKopecks / 100).toFixed(2),
      priceCurrency: opts.currency ?? 'RUB',
      availability: SCHEMA_AVAILABILITY[!product.inStock && (product.availability === undefined || product.availability === 'in_stock' || product.availability === 'preorder') ? 'out_of_stock' : (product.availability ?? 'in_stock')],
      url: absoluteUrl(siteUrl, `/product/${product.slug}`),
    };
  }
  if (rating.count > 0 && rating.average !== null) {
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: rating.average, reviewCount: rating.count };
  }
  return ld;
}

/** Organization: только заданные в настройках поля. Пустых и выдуманных значений нет. */
export function organizationJsonLd(
  shop: { siteName: string; phone: string | null; address: string | null; email: string | null; description?: string | null; socials?: { href: string }[] },
  siteUrl: string,
): Json {
  const ld: Json = { '@context': 'https://schema.org', '@type': 'Organization', name: shop.siteName, url: siteUrl };
  if (shop.description) ld.description = shop.description;
  if (shop.socials && shop.socials.length > 0) ld.sameAs = shop.socials.map((s) => s.href);
  if (shop.phone) ld.telephone = shop.phone;
  if (shop.email) ld.email = shop.email;
  if (shop.address) ld.address = { '@type': 'PostalAddress', streetAddress: shop.address, addressCountry: 'RU' };
  return ld;
}

export function breadcrumbJsonLd(items: { name: string; href: string }[], siteUrl: string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Главная', href: '/' }, ...items].map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: absoluteUrl(siteUrl, it.href),
    })),
  };
}
