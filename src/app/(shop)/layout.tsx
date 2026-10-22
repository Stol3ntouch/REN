import type { ReactNode } from 'react';
import { SiteShell } from '@/ui/layout/SiteShell';
import { getShellContext } from '@/ui/shell-context';

/** Публичный каркас: все страницы из src/app/(shop)/** получают шапку, подвал и skip-link. */
export default async function ShopLayout({ children }: { children: ReactNode }) {
  const shell = await getShellContext();
  return <SiteShell shell={shell}>{children}</SiteShell>;
}
