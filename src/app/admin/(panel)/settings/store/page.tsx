import type { Metadata } from 'next';
import { getStoreSettings } from '@/domain/content/store-settings';
import { requireStaffPage } from '@/ui/admin/guard';
import { PageHeader } from '@/ui/admin/kit';
import { Flash, str } from '../../_lib/ui';
import { SettingsTabs } from '../SettingsTabs';
import { StoreForm } from './StoreForm';

export const metadata: Metadata = { title: 'Настройки магазина' };
export const dynamic = 'force-dynamic';

export default async function StoreSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage(null);
  const sp = await searchParams;
  const settings = getStoreSettings(session);
  return (
    <>
      <PageHeader
        title="Настройки магазина"
        description="Основные параметры интернет-магазина"
        actions={
          settings.readOnly ? null : (
            <>
              <button type="reset" form="store-form" className="ak-btn ak-btn--outline">
                Сбросить изменения
              </button>
              <button type="submit" form="store-form" className="ak-btn ak-btn--primary">
                Сохранить настройки
              </button>
            </>
          )
        }
      />
      <SettingsTabs current="store" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Настройки сохранены." />
      {settings.readOnly ? <p className="ops-muted">Просмотр: для изменения настроек нужно право «Изменение настроек магазина».</p> : null}
      <StoreForm settings={settings} />
    </>
  );
}
