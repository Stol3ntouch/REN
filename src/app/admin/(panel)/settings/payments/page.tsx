import type { Metadata } from 'next';
import { requireStaffPage } from '@/ui/admin/guard';
import { EmptyState, PageHeader } from '@/ui/admin/kit';
import { SettingsTabs } from '../SettingsTabs';

export const metadata: Metadata = { title: 'Способы оплаты' };
export const dynamic = 'force-dynamic';

/** Страница раздела ведётся тикетом C12; до сдачи — честная заглушка. */
export default async function PaymentsSettingsPage() {
  await requireStaffPage('settings.write');
  return (
    <>
      <PageHeader title="Настройки магазина" />
      <SettingsTabs current="payments" />
      <div className="ak-card">
        <EmptyState title="Раздел в разработке" icon="wrench">
          <p>Способы оплаты появятся после завершения сборки.</p>
        </EmptyState>
      </div>
    </>
  );
}
