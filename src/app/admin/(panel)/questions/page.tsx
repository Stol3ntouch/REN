import { redirect } from 'next/navigation';
import { requireStaffPage } from '@/ui/admin/guard';

export const dynamic = 'force-dynamic';

/** Прежний адрес «Вопросы о товарах»: теперь это канал «question» в обращениях. */
export default async function LegacyQuestionsPage() {
  await requireStaffPage(null);
  redirect('/admin/inquiries?channel=question');
}
