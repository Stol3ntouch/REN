import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { getShopInfo } from '@/domain/content/settings';
import { effectiveSiteName, getSeoSettings, ogImageUrl, publicSiteUrl } from '@/domain/content/seo-settings';
import '@/ui/theme.css';

// Функцией, а не константой: SITE_URL читается на запросе, а не фиксируется при сборке.
// Настройки «Основные» и «SEO и метаданные»: название сайта, описание, Open Graph, favicon, canonical-правила, индексация.
export async function generateMetadata(): Promise<Metadata> {
  await connection(); // настройки лежат в БД: на сборке не вычислять
  const seo = getSeoSettings();
  const siteName = effectiveSiteName(seo);
  let faviconUrl: string | null = null;
  try {
    faviconUrl = getShopInfo().faviconUrl;
  } catch {
    faviconUrl = null;
  }
  const og = ogImageUrl(seo);
  return {
    metadataBase: new URL(publicSiteUrl()),
    title: { default: `${siteName} — товары для сада и ремонт техники`, template: `%s — ${siteName}` },
    description: seo.description || 'Садовая техника, снегоуборочный инвентарь, запчасти и сопутствующие товары. Ремонт техники.',
    icons: {
      icon: faviconUrl ? [{ url: faviconUrl }] : [{ url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' }],
      apple: [{ url: '/brand/mark-128.png', sizes: '128x128', type: 'image/png' }],
    },
    openGraph: { siteName, type: seo.ogType, locale: 'ru_RU', ...(og ? { images: [{ url: og, alt: siteName }] } : {}) },
    // «Индексировать сайт» выключен: все страницы без своего robots наследуют noindex.
    ...(seo.robotsIndex ? {} : { robots: { index: false, follow: false } }),
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/** Корень: <html lang="ru"> и тема. Шапку и подвал даёт SiteShell — через src/app/(shop)/layout.tsx. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
