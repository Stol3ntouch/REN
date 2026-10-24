import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPermission } from '@/domain/admin/permissions';
import { promoOps } from '@/domain/ordering/admin-ops';
import { formatRub } from '@/domain/pricing/format';
import { getDb } from '@/server/db/connection';
import { promosRepo, type PromoRow } from '@/server/db/repositories/promos';
import { requireStaffPage } from '@/ui/admin/guard';
import { ConfirmButton } from '@/ui/admin/kit/ConfirmButton';
import { DataTable, type DataTableColumn } from '@/ui/admin/kit/DataTable';
import { FilterPanel } from '@/ui/admin/kit/FilterPanel';
import { FormField } from '@/ui/admin/kit/FormField';
import { PageHeader } from '@/ui/admin/kit/PageHeader';
import { Pagination } from '@/ui/admin/kit/Pagination';
import { SaveBar } from '@/ui/admin/kit/SaveBar';
import { SearchInput } from '@/ui/admin/kit/SearchInput';
import { SelectField } from '@/ui/admin/kit/SelectField';
import { StatusBadge } from '@/ui/admin/kit/StatusBadge';
import { FlashToast } from '@/ui/admin/kit/Toaster';
import { Toggle } from '@/ui/admin/kit/Toggle';
import { UnsavedChangesGuard } from '@/ui/admin/kit/UnsavedChangesGuard';
import { firstParam, parseListParams, type SearchParams } from '@/ui/admin/kit/url';
import { deletePromoAction, savePromoAction } from './actions';

import '../content/content-admin.css';

export const metadata: Metadata = { title: 'Купоны' };
export const dynamic = 'force-dynamic';

const MSK = 'Europe/Moscow';
const dateOnly = (ms: number | null) => (ms === null ? '' : new Intl.DateTimeFormat('sv-SE', { timeZone: MSK }).format(new Date(ms)));
const human = (ms: number | null) => (ms === null ? '—' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: MSK }).format(new Date(ms)));
const dateTime = (ms: number) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: MSK }).format(new Date(ms));
const rubInput = (kopecks: number) => (kopecks % 100 === 0 ? String(kopecks / 100) : (kopecks / 100).toFixed(2).replace('.', ','));

const SORTS = ['created', 'code', 'used', 'ends'] as const;
const STATUSES = [
  { value: 'enabled', label: 'Включён' },
  { value: 'disabled', label: 'Выключен' },
  { value: 'expired', label: 'Срок истёк' },
  { value: 'exhausted', label: 'Лимит исчерпан' },
];

function PromoForm({ promo, canWrite }: { promo?: PromoRow; canWrite: boolean }) {
  const id = promo?.id ?? 'new';
  const formId = `promo-form-${id}`;
  return (
    <>
      <form id={formId} action={savePromoAction} className="ak-card" aria-labelledby={`${formId}-h`}>
        <h2 id={`${formId}-h`}>{promo ? `Купон ${promo.code}` : 'Новый купон'}</h2>
        {promo ? <input type="hidden" name="id" value={promo.id} /> : null}
        <div className="ak-form-grid">
          <FormField id={`${formId}-code`} name="code" label="Код" required maxLength={32} defaultValue={promo?.code} />
          <SelectField id={`${formId}-type`} name="type" label="Тип" options={[{ value: 'percent', label: 'Процент' }, { value: 'fixed', label: 'Сумма, ₽' }]} defaultValue={promo?.type ?? 'percent'} />
          <FormField id={`${formId}-value`} name="value" label="Размер (% или ₽)" required inputMode="decimal" defaultValue={promo ? (promo.type === 'percent' ? promo.value : rubInput(promo.value)) : ''} />
          <FormField id={`${formId}-from`} name="startsAt" label="Действует с" type="date" defaultValue={dateOnly(promo?.startsAt ?? null)} />
          <FormField id={`${formId}-to`} name="endsAt" label="Действует по (включительно)" type="date" defaultValue={dateOnly(promo?.endsAt ?? null)} />
          <FormField id={`${formId}-limit`} name="usageLimit" label="Лимит использований" inputMode="numeric" defaultValue={promo?.usageLimit ?? ''} />
          <FormField id={`${formId}-min`} name="minSubtotal" label="Мин. сумма заказа, ₽" inputMode="decimal" defaultValue={promo && promo.minSubtotalKopecks > 0 ? rubInput(promo.minSubtotalKopecks) : ''} />
        </div>
        <Toggle name="enabled" label="Включён" checked={promo?.enabled ?? true} />
        <Toggle
          name="excludeOnSale"
          label="Не действует на товары по акции и со скидкой"
          description="Позиции с акционной или скидочной ценой не входят в сумму, от которой считается скидка по купону."
          checked={promo?.excludeOnSale ?? false}
        />
        <p className="ak-field__hint">В заказе действует один купон: новый код в корзине заменяет прежний.</p>
        {canWrite ? <SaveBar cancelHref="/admin/promos" saveLabel={promo ? 'Сохранить изменения' : 'Создать купон'} sticky={false} /> : null}
      </form>
      <UnsavedChangesGuard formId={formId} />
    </>
  );
}

/** Отчёт об использовании купона: итоги и последние заказы (номера без контактов покупателей). */
function UsageReport({ promo }: { promo: PromoRow }) {
  const db = getDb();
  const totals = promosRepo.usageTotals(db, promo.id);
  const rows = promosRepo.usage(db, promo.id, 100);
  return (
    <section className="ak-card" aria-labelledby="usage-h">
      <h2 id="usage-h">Использование купона {promo.code}</h2>
      <p>
        Заказов (без отменённых и возвращённых): <strong>{totals.orders}</strong> · скидок выдано на <strong>{formatRub(totals.discountKopecks)}</strong> · сумма этих заказов <strong>{formatRub(totals.revenueKopecks)}</strong>. Счётчик купона: {promo.usedCount}
        {promo.usageLimit ? ` из ${promo.usageLimit}` : ''}.
      </p>
      {rows.length === 0 ? (
        <p className="ak-field__hint">Купон ещё не применялся в заказах.</p>
      ) : (
        <table className="ak-table" style={{ width: '100%' }}>
          <caption className="visually-hidden">Заказы с купоном</caption>
          <thead>
            <tr>
              <th scope="col">Заказ</th>
              <th scope="col">Дата</th>
              <th scope="col">Статус</th>
              <th scope="col">Скидка</th>
              <th scope="col">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.orderNumber}>
                <td>
                  <Link href={`/admin/orders/${r.orderNumber}`}>{r.orderNumber}</Link>
                </td>
                <td>{dateTime(r.createdAt)}</td>
                <td>{r.status}</td>
                <td>{formatRub(r.discountKopecks)}</td>
                <td>{formatRub(r.totalKopecks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const currentTime = (): number => Date.now();

export default async function AdminPromosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('catalog.read');
  const sp = await searchParams;
  promoOps.list(session); // проверка права просмотра внутри операции
  const canWrite = hasPermission(session, 'promos.write');
  const lp = parseListParams(sp, { sorts: SORTS, defaultSort: 'created', defaultDir: 'desc' });
  const statusRaw = firstParam(sp.status);
  const status = STATUSES.some((s) => s.value === statusRaw) ? (statusRaw as 'enabled') : undefined;
  const { rows, total } = promosRepo.search(getDb(), { q: lp.q, status, sort: (lp.sort ?? 'created') as 'created', dir: lp.dir, limit: lp.pageSize, offset: (lp.page - 1) * lp.pageSize }, currentTime());

  const editId = canWrite ? firstParam(sp.edit) : '';
  const reportId = firstParam(sp.report);
  const editing = editId ? promosRepo.findById(getDb(), Number(editId)) : null;
  const report = reportId ? promosRepo.findById(getDb(), Number(reportId)) : null;
  const showNew = canWrite && firstParam(sp.new) === '1';

  const columns: DataTableColumn<PromoRow>[] = [
    { key: 'code', header: 'Код', sortKey: 'code', cell: (p) => <strong>{p.code}</strong> },
    { key: 'discount', header: 'Скидка', cell: (p) => (p.type === 'percent' ? `${p.value}%` : formatRub(p.value)) },
    { key: 'period', header: 'Период', sortKey: 'ends', hideOnNarrow: true, cell: (p) => `${human(p.startsAt)} — ${human(p.endsAt)}` },
    { key: 'used', header: 'Использовано', sortKey: 'used', align: 'right', cell: (p) => `${p.usedCount}${p.usageLimit ? ` из ${p.usageLimit}` : ''}` },
    { key: 'min', header: 'Мин. сумма', hideOnNarrow: true, cell: (p) => (p.minSubtotalKopecks > 0 ? formatRub(p.minSubtotalKopecks) : '—') },
    {
      key: 'status',
      header: 'Статус',
      cell: (p) => (
        <>
          <StatusBadge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? 'Включён' : 'Выключен'}</StatusBadge>
          {p.excludeOnSale ? <div className="ak-field__hint">без акционных товаров</div> : null}
        </>
      ),
    },
    {
      key: 'actions',
      header: 'Действия',
      width: '1%',
      cell: (p) => (
        <div className="ak-row-actions">
          <Link className="ak-btn ak-btn--sm ak-btn--outline" href={`/admin/promos?report=${p.id}`}>
            Отчёт
          </Link>
          {canWrite ? (
            <>
              <Link className="ak-btn ak-btn--sm ak-btn--outline" href={`/admin/promos?edit=${p.id}`}>
                Изменить
              </Link>
              {p.usedCount === 0 ? (
                <form action={deletePromoAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <ConfirmButton title={`Удалить купон ${p.code}?`} confirmLabel="Удалить" className="ak-btn ak-btn--sm ak-btn--danger-outline" aria-label={`Удалить купон ${p.code}`}>
                    Удалить
                  </ConfirmButton>
                </form>
              ) : null}
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Купоны"
        description="Промокоды для корзины. Акции с ценами на товары — в разделе «Акции»."
        actions={
          canWrite ? (
            <Link className="ak-btn ak-btn--primary" href="/admin/promos?new=1">
              Новый купон
            </Link>
          ) : null
        }
      />
      <FlashToast ok={firstParam(sp.ok)} error={firstParam(sp.error)} okText="Сохранено." />
      {!canWrite ? <p className="ak-field__hint">У вашей роли права только на просмотр: купоны меняет администратор.</p> : null}
      <div className="ak-toolbar">
        <SearchInput label="Поиск по коду" placeholder="Код купона" defaultValue={lp.q} />
      </div>
      <FilterPanel basePath="/admin/promos" params={sp} preserve={['sort', 'dir', 'pageSize', 'q']}>
        <SelectField name="status" label="Состояние" placeholder="Все" options={STATUSES} defaultValue={status ?? ''} />
      </FilterPanel>
      <DataTable<PromoRow>
        caption="Купоны"
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        basePath="/admin/promos"
        params={sp}
        sort={lp.sort}
        dir={lp.dir}
        empty={{ title: 'Купонов пока нет', description: canWrite ? 'Создайте первый купон кнопкой сверху.' : undefined }}
        footer={<Pagination page={lp.page} pageSize={lp.pageSize} total={total} basePath="/admin/promos" params={sp} />}
      />
      {report ? <UsageReport promo={report} /> : null}
      {canWrite && (editing || showNew) ? <PromoForm key={editing?.id ?? 'new'} promo={editing ?? undefined} canWrite /> : null}
    </>
  );
}
