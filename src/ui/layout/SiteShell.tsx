import type { ReactNode } from 'react';
import { DEFAULT_SHELL, type ShellContext } from '../shell-context';
import './layout.css';
import { MobileTabBar } from './MobileTabBar';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { SkipLink } from './SkipLink';

/**
 * Общий каркас публичной страницы: skip-link, шапка, <main id="main">, подвал и нижняя панель на телефоне.
 * Оборачивает страницы группы src/app/(shop)/ (через её layout.tsx); для других
 * разделов (account, 404) используйте напрямую.
 */
export function SiteShell({ children, shell = DEFAULT_SHELL }: { children: ReactNode; shell?: ShellContext }) {
  return (
    <>
      <SkipLink />
      <SiteHeader shell={shell} />
      <main id="main" className="site-main container" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter shell={shell} />
      <MobileTabBar />
    </>
  );
}
