import type { Metadata } from 'next';
import { requireStaffPage } from '@/ui/admin/guard';
import { settingsOps } from '../_lib/settings-ops';
import { ACCESS_NAV, Flash, str, SubNav } from '../_lib/ui';
import { setManualEditAction, setRecipientsAction } from './actions';

export const metadata: Metadata = { title: 'Настройки' };
export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('settings.write');
  const sp = await searchParams;
  const settings = settingsOps.get(session);

  return (
    <>
      <h1>Настройки</h1>
      <SubNav items={ACCESS_NAV} current="/admin/settings" />
      <Flash ok={str(sp.ok)} error={str(sp.error)} okText="Сохранено." />

      <form action={setManualEditAction} className="adm-card" aria-labelledby="me-h">
        <h2 id="me-h">Ручное редактирование каталога</h2>
        <p>
          По умолчанию цены, наличие и описания приходят из импорта YML / 1С и в админке только читаются. Если включить ручное редактирование, администратор сможет править цену, скидочную цену, публикацию,
          «рекомендуемый товар», описание и SEO. Правленые поля закрепляются: импорт их не перезапишет. Каждая правка попадает в журнал аудита.
        </p>
        <label>
          <input type="checkbox" name="enabled" defaultChecked={settings.manualEdit} /> Разрешить ручное редактирование каталога
        </label>
        <div className="adm-inline">
          <button type="submit" className="button">
            Сохранить
          </button>
        </div>
      </form>

      <form action={setRecipientsAction} className="adm-card" aria-labelledby="rc-h">
        <h2 id="rc-h">Получатели служебных уведомлений</h2>
        <p>Адреса, на которые будут приходить уведомления о новых заказах и заявках. Через запятую или с новой строки, не больше 10.</p>
        <div className="adm-field">
          <label htmlFor="set-rc">Email получателей</label>
          <textarea id="set-rc" name="recipients" className="ops-textarea" defaultValue={settings.recipients.join('\n')} maxLength={1000} />
        </div>
        <div className="adm-inline">
          <button type="submit" className="button">
            Сохранить
          </button>
        </div>
      </form>
      <p className="ops-muted">Контакты магазина, адрес, график работы и SEO сайта настраиваются в разделе контента.</p>
    </>
  );
}
