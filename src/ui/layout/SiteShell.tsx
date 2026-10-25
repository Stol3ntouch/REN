import type { ReactNode } from 'react';
import { DEFAULT_SHELL, type ShellContext } from '../shell-context';
import './layout.css';
import { MobileTabBar } from './MobileTabBar';
import { TopStrip } from './TopStrip';
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
      {shell.maintenanceBanner ? (
        <div className="maintenance-banner" role="status">
          Включён режим технического обслуживания: посетители видят страницу «Технические работы», а вы — сайт, потому что вошли в админку.
        </div>
      ) : null}
      {shell.topStrip ? <TopStrip text={shell.topStrip.text} href={shell.topStrip.href} /> : null}
      <SiteHeader shell={shell} />
      <main id="main" className="site-main container" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter shell={shell} />
      <MobileTabBar showCart={shell.showPrices !== false} />
    </>
  );
}
