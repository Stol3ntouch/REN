'use client';

import { usePathname } from 'next/navigation';
import { buildBreadcrumbs } from '../nav-core';
import { Breadcrumbs } from './Breadcrumbs';

/** Хлебные крошки по текущему адресу и меню: Главная › раздел › остаток пути. Стоит в каркасе — на страницах не нужны. */
export function AutoBreadcrumbs() {
  const pathname = usePathname() ?? '/admin';
  return <Breadcrumbs items={buildBreadcrumbs(pathname)} />;
}
