import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireStaffPage } from '@/ui/admin/guard';

export const metadata: Metadata = { title: 'Почта' };
export const dynamic = 'force-dynamic';

/** Журнал и настройки почты переехали в «Настройки магазина → Email и уведомления» (C12). Старый адрес ведёт туда. */
export default async function AdminMailPage() {
  await requireStaffPage(null);
  redirect('/admin/settings/email');
}
