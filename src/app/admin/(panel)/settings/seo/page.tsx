import type { Metadata } from 'next';
import { getSeoSettingsView } from '@/domain/content/seo-settings';
import { requireStaffPage } from '@/ui/admin/guard';
import { PageHeader } from '@/ui/admin/kit';
import { Flash, str } from '../../_lib/ui';
import { SettingsTabs } from '../SettingsTabs';
import { SeoForm } from './SeoForm';

export const metadata: Metadata = { title: 'SEO и метаданные' };
export const dynamic = 'force-dynamic';

export default async function SeoSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage(null);
  const sp = await searchParams;
  const seo = getSeoSettingsView(session);
  return (
    <>
      <PageHeader
        title="Настройки магазина"
        description="SEO и метаданные сайта"
        actions={
          seo.readOnly ? null : (
            <>
              <button type="reset" form="seo-form" className="ak-btn ak-btn--outline">
                Сбросить изменения
              </button>
              <button type="submit" form="seo-form" className="ak-btn ak-btn--primary">
                Сохранить настройки
              </button>
            </>
          )
        }
      />
      <SettingsTabs current="seo" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="SEO-настройки сохранены." />
      {seo.readOnly ? <p className="ops-muted">Просмотр: для изменения нужно право «SEO и метаданные».</p> : null}
      <SeoForm seo={seo} />
    </>
  );
}
