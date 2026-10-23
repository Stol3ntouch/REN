import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { resolveSiteUrl } from '@/domain/seo/site-url';
import '@/ui/theme.css';

// Функцией, а не константой: SITE_URL читается на запросе, а не фиксируется при сборке.
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(resolveSiteUrl()),
    title: { default: 'РемТехСад — товары для сада и ремонт техники', template: '%s — РемТехСад' },
    description: 'Садовая техника, снегоуборочный инвентарь, запчасти и сопутствующие товары. Ремонт техники.',
    icons: {
      icon: [{ url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' }],
      apple: [{ url: '/brand/mark-128.png', sizes: '128x128', type: 'image/png' }],
    },
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
