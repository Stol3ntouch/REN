import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getShopInfo } from '@/domain/content/settings';
import { getStoreFlags } from '@/domain/content/store-flags';
import { getDeliveryPaymentText } from '@/domain/catalog/shop-text';
import { getProductBySlug, getRelatedProducts } from '@/domain/catalog/product';
import { breadcrumbJsonLd, productJsonLd } from '@/domain/seo/jsonld';
import { loadProductSeoContext, productMetadata } from '@/domain/seo/metadata';
import { resolveSiteUrl } from '@/domain/seo/site-url';
import { getProductSeo } from '@/domain/seo/store';
import { getProductRating } from '@/domain/requests/public';
import { JsonLd } from '@/ui/seo/JsonLd';
import { AddToCartButton } from '@/ui/catalog/AddToCartButton';
import { Breadcrumbs } from '@/ui/catalog/Breadcrumbs';
import { PriceBlock } from '@/ui/catalog/PriceBlock';
import { ProductCard } from '@/ui/catalog/ProductCard';
import { ProductGallery } from '@/ui/catalog/ProductGallery';
import { ProductActionsSlot } from '@/ui/catalog/slots';
import { ProductFeedback, RatingBadge } from '@/ui/forms/ProductFeedback';
import { Placeholder } from '@/ui/placeholder';
import '@/ui/catalog/catalog.css';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: 'Товар не найден', robots: { index: false } };
  return productMetadata(product, getProductSeo(product.id), loadProductSeoContext(product.id));
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const related = await getRelatedProducts(product.id);
  const deliveryText = getDeliveryPaymentText();
  const siteUrl = resolveSiteUrl();
  const showPrices = getStoreFlags().showPrices;

  return (
    <article className="product-page">
      <JsonLd data={productJsonLd(product, getProductRating(product.id), siteUrl, { withOffers: showPrices, currency: getShopInfo().currency })} />
      <JsonLd data={breadcrumbJsonLd([{ name: 'Каталог', href: '/catalog' }, ...product.breadcrumbs, { name: product.name, href: `/product/${product.slug}` }], siteUrl)} />
      <Breadcrumbs items={[{ name: 'Каталог', href: '/catalog' }, ...product.breadcrumbs]} current={product.name} />

      <div className="product-top">
        <ProductGallery images={product.images} thumbs={product.thumbs} name={product.name} />

        <div className="product-info">
          <h1 className="product-info__title">{product.name}</h1>
          {product.sku ? <p className="product-info__sku">Артикул: {product.sku}</p> : null}
          <RatingBadge productId={product.id} />
          {product.isNew || product.isPromo ? (
            <ul className="product-badges product-badges--inline" aria-label="Метки товара">
              {product.isNew ? <li className="product-badge product-badge--new">Новинка</li> : null}
              {product.isPromo ? <li className="product-badge product-badge--promo">Акция</li> : null}
            </ul>
          ) : null}
          <p className={`stock stock--${product.availability === 'preorder' ? 'preorder' : product.inStock ? 'yes' : 'no'}`}>
            {product.availability === 'preorder' ? 'Под заказ' : product.availability === 'discontinued' ? 'Снят с продажи' : product.inStock ? 'В наличии' : 'Нет в наличии'}
          </p>
          {product.shortDescription ? <p className="product-info__short">{product.shortDescription}</p> : null}
          <PriceBlock unitKopecks={product.unitKopecks} originalKopecks={product.originalKopecks} size="lg" />
          <div className="product-info__buy">
            {showPrices ? <AddToCartButton productId={product.id} inStock={product.inStock} name={product.name} withQuantity /> : null}
            <div className="product-info__actions">
              <ProductActionsSlot product={{ id: product.id, name: product.name }} />
            </div>
          </div>
        </div>
      </div>

      {product.descriptionHtml ? (
        <section className="product-section" aria-labelledby="product-description">
          <h2 id="product-description">Описание</h2>
          {/* Описание санитизировано при импорте (белый список тегов без атрибутов). */}
          <div className="product-description" dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
        </section>
      ) : null}

      {product.attributes.length > 0 ? (
        <section className="product-section" aria-labelledby="product-attributes">
          <h2 id="product-attributes">Характеристики</h2>
          <table className="attributes-table">
            <tbody>
              {product.attributes.map((a, i) => (
                <tr key={`${a.name}-${i}`}>
                  <th scope="row">{a.name}</th>
                  <td>{a.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="product-section" aria-labelledby="product-delivery">
        <h2 id="product-delivery">Доставка и оплата</h2>
        {deliveryText ? (
          deliveryText
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p, i) => <p key={i}>{p}</p>)
        ) : (
          <p>
            <Placeholder label="УСЛОВИЯ ДОСТАВКИ И ОПЛАТЫ" />
          </p>
        )}
      </section>

      <ProductFeedback productId={product.id} />

      {related.length > 0 ? (
        <section className="product-section" aria-labelledby="product-related">
          <h2 id="product-related">Сопутствующие товары</h2>
          <ul className="product-grid">
            {related.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
