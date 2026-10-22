import type { Metadata } from 'next';
import Link from 'next/link';
import { ErrorState, EmptyState } from '@/ui/states';
import { requireStaffPage } from '@/ui/admin/guard';
import { visibleNav } from '@/ui/admin/nav';

export const metadata: Metadata = { title: 'Обзор' };

/** Заглушка «Обзор»: сводные показатели появятся вместе с заказами и аналитикой. */
export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const session = await requireStaffPage();
  const sp = await searchParams;
  const sections = visibleNav(session.role).filter((i) => i.href !== '/admin');

  return (
    <>
      <h1>Обзор</h1>
      {sp.forbidden ? (
        <ErrorState title="Недостаточно прав">
          <p>У вашей роли нет доступа к этому разделу.</p>
        </ErrorState>
      ) : null}
      <EmptyState title="Показателей пока нет">
        <p>Сводка по заказам и заявкам появится после запуска магазина.</p>
      </EmptyState>
      <h2>Разделы</h2>
      <ul className="admin-cards">
        {sections.map((s) => (
          <li key={s.key} className="admin-card">
            <Link href={s.href}>{s.label}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
