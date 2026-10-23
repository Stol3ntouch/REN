import Link from 'next/link';
import type { ReactNode } from 'react';
import type { HomeData } from '@/domain/content/home';
import { pluralize } from '@/domain/catalog/format';
import type { ProductCard as ProductCardData } from '@/domain/catalog/types';
import { Placeholder } from '../placeholder';
import { ProductCard } from '../catalog/ProductCard';
import { ProductImage } from '../catalog/ProductImage';
import { ShopMap } from '../map/ShopMapBlock';
import { CALLBACK_HREF } from '../nav';
import '../catalog/catalog.css';
import { NewsCard, ReviewCard, ServiceCard } from './cards';
import './home.css';
import { HomeHero } from './HomeHero';
import { ArrowRightIcon, BoxIcon, CartLineIcon, ChevronRightIcon, ClipboardIcon, ClockIcon, GearIcon, LeafIcon, MailIcon, PhoneIcon, PinIcon, WrenchIcon } from './home-icons';
import { HomeProductTabs, type ProductTab } from './HomeProductTabs';
import { excerptText, RichText } from './RichText';

function Section({ id, title, more, children }: { id: string; title: string; more?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className="home-section" aria-labelledby={id}>
      <div className="home-section__head">
        <h2 id={id}>{title}</h2>
        {more ? (
          <Link className="home-section__more" href={more.href}>
            {more.label}
            <ArrowRightIcon size={18} />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Полоса преимуществ. Формулировки — только то, что есть на сайте: без обещаний сроков, гарантий и «опыта». */
const ADVANTAGES = [
  { icon: <LeafIcon />, text: 'Подберём новую технику' },
  { icon: <WrenchIcon />, text: 'Починим старую' },
  { icon: <BoxIcon />, text: 'Каталог садовой техники и запчастей' },
  { icon: <CartLineIcon />, text: 'Заказ онлайн' },
  { icon: <ClipboardIcon />, text: 'Заявка на ремонт на сайте' },
];

const ABOUT_POINTS = [
  { icon: <LeafIcon size={24} />, text: 'Подбор техники' },
  { icon: <WrenchIcon size={24} />, text: 'Ремонт техники' },
  { icon: <BoxIcon size={24} />, text: 'Запчасти и товары для сада' },
  { icon: <GearIcon size={24} />, text: 'Заказ и заявка на сайте' },
];

function ProductList({ products, hit, newIds }: { products: ProductCardData[]; hit: boolean; newIds: Set<number> }) {
  return (
    <ul className="product-grid home-products">
      {products.map((p) => {
        const sale = p.originalKopecks !== undefined && p.originalKopecks > p.unitKopecks;
        const badges: { cls: string; text: string }[] = [];
        if (sale) badges.push({ cls: 'sale', text: 'Акция' });
        if (hit) badges.push({ cls: 'hit', text: 'Хит' });
        if (newIds.has(p.id)) badges.push({ cls: 'new', text: 'Новинка' });
        return (
          <li key={p.id} className="home-products__item">
            {badges.length > 0 ? (
              <span className="home-badges">
                {badges.map((b) => (
                  <span key={b.cls} className={`home-badge home-badge--${b.cls}`}>
                    {b.text}
                  </span>
                ))}
              </span>
            ) : null}
            <ProductCard product={p} />
          </li>
        );
      })}
    </ul>
  );
}

/** Вкладки показываются только непустые; нет ни одной — запасной блок «Каталог» из первых товаров по алфавиту. */
function productTabs(data: HomeData): { title: string; tabs: ProductTab[] } {
  const newIds = new Set(data.newProducts.map((p) => p.id));
  const tabs: ProductTab[] = [];
  if (data.popularProducts.length > 0) tabs.push({ key: 'hits', label: 'Хиты', content: <ProductList products={data.popularProducts} hit newIds={newIds} /> });
  if (data.promoProducts.length > 0) tabs.push({ key: 'sale', label: 'Акции', content: <ProductList products={data.promoProducts} hit={false} newIds={newIds} /> });
  if (data.newProducts.length > 0) tabs.push({ key: 'new', label: 'Новинки', content: <ProductList products={data.newProducts} hit={false} newIds={newIds} /> });
  if (tabs.length === 0 && data.catalogProducts.length > 0) {
    return { title: 'Товары каталога', tabs: [{ key: 'catalog', label: 'Каталог', content: <ProductList products={data.catalogProducts} hit={false} newIds={newIds} /> }] };
  }
  return { title: 'Популярные товары', tabs };
}

/**
 * Главная в стиле эталона: герой на всю ширину, преимущества, категории с фото, вкладки товаров, промо-баннеры,
 * отзывы, «О компании», контакты с картой. Блоки без данных не выводятся вовсе; «О компании» и «Контакты»
 * остаются и показывают метки-заглушки, пока владелец не заполнил тексты. Рейтингов и «звёзд» нет без отзывов.
 */
export function HomeView({ data }: { data: HomeData }) {
  const { shop } = data;
  const products = productTabs(data);
  const banners = data.promotions.slice(0, 2);
  return (
    <div className="home">
      <HomeHero title={data.seo.h1} slides={data.slides} />

      <ul className="home-advantages" aria-label="Что мы делаем">
        {ADVANTAGES.map((a) => (
          <li key={a.text} className="home-advantages__item">
            <span className="home-advantages__icon">{a.icon}</span>
            <span>{a.text}</span>
          </li>
        ))}
      </ul>

      {data.categories.length > 0 ? (
        <Section id="home-categories" title="Популярные категории" more={{ href: '/catalog', label: 'Перейти в каталог' }}>
          <ul className="category-tiles">
            {data.categories.map((c) => (
              <li key={c.id}>
                <Link className="category-tile" href={`/catalog/${c.slug}`}>
                  <ProductImage image={c.image ? { ...c.image, alt: '' } : null} name={c.name} sizes="(min-width: 64rem) 12rem, 45vw" />
                  <span className="category-tile__row">
                    <span className="category-tile__text">
                      <span className="category-tile__name">{c.name}</span>
                      <span className="category-tile__count">
                        {c.productCount} {pluralize(c.productCount, ['товар', 'товара', 'товаров'])}
                      </span>
                    </span>
                    <ChevronRightIcon size={20} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {products.tabs.length > 0 ? (
        <Section id="home-products" title={products.title} more={{ href: '/catalog', label: 'Смотреть все товары' }}>
          <HomeProductTabs tabs={products.tabs} labelledBy="home-products" />
        </Section>
      ) : null}

      {banners.length > 0 ? (
        <section className="home-banners" aria-label="Акции">
          <ul className={`home-banners__list${banners.length === 1 ? ' home-banners__list--single' : ''}`}>
            {banners.map((p) => (
              <li key={p.id} className="home-banner">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- локальный WebP из каталога загрузок
                  <img className="home-banner__image" src={p.image.src} alt="" width={p.image.width ?? 640} height={p.image.height ?? 320} loading="lazy" decoding="async" />
                ) : null}
                <div className="home-banner__text">
                  <p className="home-banner__title">{p.title}</p>
                  {p.summary ? <p className="home-banner__summary">{p.summary}</p> : null}
                  <Link className="button button--light" href={`/promotions/${p.slug}`}>
                    Смотреть
                    <ArrowRightIcon size={18} />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
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

      <section className="home-about" aria-labelledby="home-about">
        <div className="home-about__art" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- фирменный знак из public/brand */}
          <img src="/brand/mark-128.png" alt="" width={96} height={96} loading="lazy" decoding="async" />
        </div>
        <div className="home-about__body">
          <h2 id="home-about">О компании РемТехСад</h2>
          <RichText text={data.about ? excerptText(data.about.body) : '[ТЕКСТ О КОМПАНИИ — впиши]'} />
          <Link className="button button--outline" href="/about">
            Подробнее о компании
            <ArrowRightIcon size={18} />
          </Link>
        </div>
        <ul className="home-about__points">
          {ABOUT_POINTS.map((a) => (
            <li key={a.text}>
              <span className="home-about__icon">{a.icon}</span>
              {a.text}
            </li>
          ))}
        </ul>
      </section>

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

      <section className="home-section" aria-labelledby="home-contacts">
        <div className="home-section__head">
          <h2 id="home-contacts">Наши контакты</h2>
        </div>
        <div className="home-contacts">
          <div className="home-contacts__card">
            <ul className="home-contacts__list">
              <li>
                <PhoneIcon size={22} />
                <span>
                  <span className="home-contacts__label">Телефон</span>
                  {shop.phone ? <a href={shop.phoneHref ?? undefined}>{shop.phone}</a> : <Placeholder label="ТЕЛЕФОН" />}
                </span>
              </li>
              <li>
                <ClockIcon size={22} />
                <span>
                  <span className="home-contacts__label">Часы работы</span>
                  {shop.hours ?? <Placeholder label="ЧАСЫ РАБОТЫ" />}
                </span>
              </li>
              <li>
                <PinIcon size={22} />
                <span>
                  <span className="home-contacts__label">Адрес</span>
                  {shop.address ?? <Placeholder label="АДРЕС" />}
                </span>
              </li>
              <li>
                <MailIcon size={22} />
                <span>
                  <span className="home-contacts__label">Электронная почта</span>
                  {shop.email ? <a href={`mailto:${shop.email}`}>{shop.email}</a> : <Placeholder label="EMAIL" />}
                </span>
              </li>
            </ul>
            <a className="button button--outline" href={CALLBACK_HREF}>
              Заказать звонок
            </a>
          </div>
          <ShopMap latitude={shop.latitude} longitude={shop.longitude} address={shop.address} />
        </div>
      </section>
    </div>
  );
}
