import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@/ui/theme.css';

function siteUrl(): URL | undefined {
  try {
    return process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined;
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: 'РемТехСад — товары для сада и ремонт техники', template: '%s — РемТехСад' },
  description: 'Садовая техника, снегоуборочный инвентарь, запчасти и сопутствующие товары. Ремонт техники.',
};

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
