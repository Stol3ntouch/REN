import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireStaffPage } from '@/ui/admin/guard';
import { SoonView } from '@/ui/admin/kit/SoonView';
import { findNavEntryByPath } from '@/ui/admin/nav';

export const dynamic = 'force-dynamic';

/** Заголовок вкладки — название пункта; для адреса вне меню — «Страница не найдена». */
export async function generateMetadata({ params }: { params: Promise<{ soon: string[] }> }): Promise<Metadata> {
  const { soon } = await params;
  const entry = findNavEntryByPath(`/admin/${soon.join('/')}`);
  return { title: entry?.pending ? entry.label : 'Страница не найдена' };
}

/**
 * Заглушка для пунктов меню, чьи страницы ещё не сданы своими тикетами (пункты с `pending` в nav-core.ts).
 * Существующие маршруты имеют приоритет и сюда не попадают. Путь, которого нет в меню, — 404.
 * Владелец-тикет создаёт обычный page.tsx по адресу пункта и снимает `pending`.
 */
export default async function AdminSoonPage({ params }: { params: Promise<{ soon: string[] }> }) {
  await requireStaffPage(null); // сначала — вход; право конкретного пункта проверяем ниже
  const { soon } = await params;
  const href = `/admin/${soon.join('/')}`;
  const entry = findNavEntryByPath(href);
  if (!entry || !entry.pending) notFound();
  await requireStaffPage(entry.permission);
  return <SoonView href={href} />;
}
