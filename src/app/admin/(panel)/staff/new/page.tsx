import type { Metadata } from 'next';
import { PageHeader } from '@/ui/admin/kit';
import { requireStaffPage } from '@/ui/admin/guard';
import { staffOps } from '../../_lib/staff-ops';
import { NewStaffForm } from '../StaffForms';

export const metadata: Metadata = { title: 'Новый пользователь' };
export const dynamic = 'force-dynamic';

export default async function AdminStaffNewPage() {
  const session = await requireStaffPage('users.manage');
  const roles = staffOps.assignableRoles(session).map((r) => ({ value: r.code, label: r.name }));
  return (
    <>
      <PageHeader title="Новый пользователь" description="Задайте пароль сразу или выдайте одноразовую ссылку-приглашение" />
      <NewStaffForm roles={roles} />
    </>
  );
}
