import type { Metadata } from 'next';
import { requireStaffPage } from '@/ui/admin/guard';
import { SoonView } from '@/ui/admin/kit/SoonView';

export const metadata: Metadata = { title: 'Раздел в разработке' };
export const dynamic = 'force-dynamic';

/**
 * Временная заглушка: статический маршрут нужен, потому что соседний динамический ([id], [entity]) иначе ответил бы 404.
 * Тикет-владелец раздела заменяет файл настоящей страницей и снимает `pending` у пункта в nav-core.ts.
 */
export default async function FiltersSoonPage() {
  await requireStaffPage('catalog.read');
  return <SoonView href="/admin/catalog/filters" />;
}
