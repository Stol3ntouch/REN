import { redirect } from 'next/navigation';
import { requireStaffPage } from '@/ui/admin/guard';

/** Раздел «Контент» открывается на страницах. Право content.write: менеджер уходит на обзор. */
export default async function ContentIndexPage() {
  await requireStaffPage('content.write');
  redirect('/admin/content/pages');
}
