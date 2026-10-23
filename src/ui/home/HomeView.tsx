import Link from 'next/link';
import type { ReactNode } from 'react';
import type { HomeData } from '@/domain/content/home';
import type { ProductCard as ProductCardData } from '@/domain/catalog/types';
import { Placeholder } from '../placeholder';
import { ProductCard } from '../catalog/ProductCard';
import { ProductImage } from '../catalog/ProductImage';
import { ShopMap } from '../map/ShopMapBlock';
import { CALLBACK_HREF } from '../nav';
import '../catalog/catalog.css';
import { NewsCard, PromotionCard, ReviewCard, ServiceCard } from './cards';
import './home.css';
import { HomeSlider } from './HomeSlider';
import { excerptText, RichText } from './RichText';

function Section({ id, title, more, children }: { id: string; title: string; more?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className="home-section" aria-labelledby={id}>
      <div className="home-section__head">
        <h2 id={id}>{title}</h2>
        {more ? (
          <Link className="home-section__more" href={more.href}>
            {more.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ProductRow({ id, title, products, more }: { id: string; title: string; products: ProductCardData[]; more: { href: string; label: string } }) {
  if (products.length === 0) return null;
  return (
    <Section id={id} title={title} more={more}>
      <ul className="product-grid">
        {products.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Главная. Блоки без данных не выводятся вовсе (нет слайдов → нет слайдера, нет акционных → нет блока);
 * «О компании» и «Контакты» остаются и показывают метки-заглушки, пока владелец не заполнил тексты.
 */
export function HomeView({ data }: { data: HomeData }) {
  const { shop } = data;
  return (
    <div className="home">
      <h1 className="home__title">{data.seo.h1}</h1>

      {data.slides.length > 0 ? <HomeSlider slides={data.slides} /> : null}

      {data.categories.length > 0 ? (
        <Section id="home-categories" title="Популярные категории" more={{ href: '/catalog', label: 'Перейти в каталог' }}>
          <ul className="category-tiles">
            {data.categories.map((c) => (
              <li key={c.id}>
                <Link className="category-tile" href={`/catalog/${c.slug}`}>
                  <ProductImage image={c.image} name={c.name} sizes="(min-width: 64rem) 12rem, 45vw" />
                  <span className="category-tile__name">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <ProductRow id="home-new" title="Новинки" products={data.newProducts} more={{ href: '/catalog', label: 'Смотреть все товары' }} />
      <ProductRow id="home-popular" title="Популярные товары" products={data.popularProducts} more={{ href: '/catalog', label: 'Смотреть все товары' }} />
      <ProductRow id="home-promo" title="Акционные товары" products={data.promoProducts} more={{ href: '/catalog', label: 'Смотреть все товары' }} />

      {data.promotions.length > 0 ? (
        <Section id="home-promotions" title="Акции" more={{ href: '/promotions', label: 'Все акции' }}>
          <ul className="info-grid">
            {data.promotions.slice(0, 3).map((p) => (
              <li key={p.id}>
                <PromotionCard item={p} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {data.services.length > 0 ? (
        <Section id="home-services" title="Услуги" more={{ href: '/services', label: 'Все услуги' }}>
          <ul className="info-grid">
            {data.services.slice(0, 3).map((s) => (
              <li key={s.id}>
                <ServiceCard item={s} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {data.reviews.length > 0 ? (
        <Section id="home-reviews" title="Отзывы о компании" more={{ href: '/about/reviews', label: 'Все отзывы' }}>
          <ul className="info-grid">
            {data.reviews.map((r) => (
              <li key={r.id}>
                <ReviewCard item={r} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="home-about" title="О компании" more={{ href: '/about', label: 'Подробнее о компании' }}>
        <RichText text={data.about ? excerptText(data.about.body) : '[ТЕКСТ О КОМПАНИИ — впиши]'} />
      </Section>

      {data.news.length > 0 ? (
        <Section id="home-news" title="Новости" more={{ href: '/news', label: 'Все новости' }}>
          <ul className="info-grid">
            {data.news.map((n) => (
              <li key={n.id}>
                <NewsCard item={n} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="home-contacts" title="Контакты">
        <div className="home-contacts">
          <dl className="home-contacts__list">
            <div>
              <dt>Телефон</dt>
              <dd>{shop.phone ? <a href={shop.phoneHref ?? undefined}>{shop.phone}</a> : <Placeholder label="ТЕЛЕФОН" />}</dd>
            </div>
            <div>
              <dt>Часы работы</dt>
              <dd>{shop.hours ?? <Placeholder label="ЧАСЫ РАБОТЫ" />}</dd>
            </div>
            <div>
              <dt>Адрес</dt>
              <dd>{shop.address ?? <Placeholder label="АДРЕС" />}</dd>
            </div>
            {shop.email ? (
              <div>
                <dt>Электронная почта</dt>
                <dd>
                  <a href={`mailto:${shop.email}`}>{shop.email}</a>
                </dd>
              </div>
            ) : null}
          </dl>
          <a className="button button--outline" href={CALLBACK_HREF}>
            Заказать звонок
          </a>
          <ShopMap latitude={shop.latitude} longitude={shop.longitude} address={shop.address} />
        </div>
      </Section>
    </div>
  );
}
