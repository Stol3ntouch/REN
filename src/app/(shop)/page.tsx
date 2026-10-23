import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getHomeData } from '@/domain/content/home';
import { contentMetadata } from '@/domain/content/seo';
import { getSettings, getShopInfo } from '@/domain/content/settings';
import { organizationJsonLd } from '@/domain/seo/jsonld';
import { resolveSiteUrl } from '@/domain/seo/site-url';
import { JsonLd } from '@/ui/seo/JsonLd';
import { HomeView } from '@/ui/home/HomeView';

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const s = getSettings();
  const base = contentMetadata({ title: 'РемТехСад — товары для сада и ремонт техники', seoTitle: s.home_title, seoDescription: s.home_description, path: '/' });
  // у главной название уже полное: без шаблона «… — РемТехСад»
  return { ...base, title: { absolute: s.home_title?.trim() || 'РемТехСад — товары для сада и ремонт техники' } };
}

/** Главная: слайдер, категории, товарные блоки, акции, услуги, отзывы, о компании, контакты и карта. Пустые блоки скрыты. */
export default async function HomePage() {
  await connection(); // читает БД: не пререндерить на сборке
  return (
    <>
      <JsonLd data={organizationJsonLd(getShopInfo(), resolveSiteUrl())} />
      <HomeView data={await getHomeData()} />
    </>
  );
}
