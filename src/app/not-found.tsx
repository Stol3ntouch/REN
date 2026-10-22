import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/ui/layout/SiteShell';
import { getShellContext } from '@/ui/shell-context';
import { EmptyState } from '@/ui/states';

export const metadata: Metadata = { title: 'Страница не найдена', robots: { index: false } };

export default async function NotFound() {
  const shell = await getShellContext();
  return (
    <SiteShell shell={shell}>
      <h1>Страница не найдена</h1>
      <EmptyState title="Такой страницы нет">
        <p>
          Проверьте адрес или перейдите <Link href="/">на главную</Link>.
        </p>
      </EmptyState>
    </SiteShell>
  );
}
