import { redirect } from 'next/navigation';
import { requireStaffPage } from '@/ui/admin/guard';

export const dynamic = 'force-dynamic';

/** Прежний адрес «Заявки»: обращения теперь в /admin/inquiries, ремонт — в /admin/repairs (старая ссылка ?kind=repair ведёт в ремонт). */
export default async function LegacyRequestsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireStaffPage(null);
  const { kind } = await searchParams;
  redirect(kind === 'repair' ? '/admin/repairs' : '/admin/inquiries');
}
