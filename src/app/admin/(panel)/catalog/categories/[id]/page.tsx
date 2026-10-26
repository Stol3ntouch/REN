import { redirect } from 'next/navigation';
import { requireStaffPage } from '@/ui/admin/guard';

export const dynamic = 'force-dynamic';

/** Прежний адрес карточки категории: теперь карточка и дерево на одной странице (выбранная категория — в ?id=). */
export default async function AdminCategoryLegacyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage('catalog.read');
  const { id } = await params;
  const n = Number(id);
  redirect(Number.isInteger(n) && n > 0 ? `/admin/catalog/categories?id=${n}&tab=seo` : '/admin/catalog/categories');
}
