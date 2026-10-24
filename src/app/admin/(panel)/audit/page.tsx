import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable, FilterPanel, FormField, PageHeader, Pagination, SelectField, StatusBadge, buildHref, parseListParams, type DataTableColumn } from '@/ui/admin/kit';
import { requireStaffPage } from '@/ui/admin/guard';
import type { AuditSearchRow } from '@/server/db/repositories/audit';
import { auditFilterFromParams } from '../_lib/audit-params';
import { auditOps } from '../_lib/audit-ops';
import { fmtTime, str } from '../_lib/ui';

export const metadata: Metadata = { title: 'Журнал действий' };
export const dynamic = 'force-dynamic';

const short = (v: unknown): string => {
  if (v === undefined) return '—';
  const s = JSON.stringify(v);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
};

const TONE = { ok: 'success', denied: 'warning', error: 'danger' } as const;
const LABEL = { ok: 'Успешно', denied: 'Отказ', error: 'Ошибка' } as const;

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireStaffPage('audit.read');
  const sp = await searchParams;
  const lp = parseListParams(sp, { defaultPageSize: 50 });
  const filter = auditFilterFromParams(sp);
  const result = auditOps.list(session, { ...filter, page: lp.page, pageSize: lp.pageSize });
  const exportHref = buildHref('/admin/audit/export', sp, { page: null, pageSize: null, sort: null, dir: null });

  const columns: DataTableColumn<AuditSearchRow>[] = [
    { key: 'at', header: 'Время', cell: (r) => fmtTime(r.at) },
    { key: 'actor', header: 'Пользователь', cell: (r) => r.actorLabel ?? (r.actorId ? `${r.actorType} #${r.actorId}` : r.actorType) },
    { key: 'action', header: 'Действие', cell: (r) => <code>{r.action}</code> },
    { key: 'entity', header: 'Объект', cell: (r) => `${r.entity}${r.entityId ? ` #${r.entityId}` : ''}` },
    { key: 'result', header: 'Результат', cell: (r) => <StatusBadge tone={TONE[r.result]}>{LABEL[r.result]}</StatusBadge> },
    {
      key: 'details',
      header: 'Детали',
      cell: (r) =>
        r.before === undefined && r.after === undefined && !r.ipHash ? (
          '—'
        ) : (
          <details>
            <summary>Показать</summary>
            <p>
              Было: <code>{short(r.before)}</code>
            </p>
            <p>
              Стало: <code>{short(r.after)}</code>
            </p>
            {r.ipHash ? <p className="ak-field__hint">Запрос (хеш): {r.ipHash}</p> : null}
          </details>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Журнал действий"
        description="Записи нельзя изменить или удалить. Email и телефоны замаскированы, пароли и токены не записываются."
        actions={
          <Link href={exportHref} className="ak-btn ak-btn--outline" prefetch={false}>
            Экспорт CSV
          </Link>
        }
      />
      <FilterPanel basePath="/admin/audit" params={sp}>
        <FormField name="actor" label="Пользователь (id)" defaultValue={filter.actorId ?? ''} inputMode="numeric" maxLength={20} />
        <FormField name="from" label="С даты" type="date" defaultValue={str(sp.from)} />
        <FormField name="to" label="По дату" type="date" defaultValue={str(sp.to)} />
        <FormField name="action" label="Тип действия" defaultValue={filter.actionPrefix ?? ''} placeholder="staff., order.status…" maxLength={80} />
        <FormField name="entity" label="Объект" defaultValue={filter.entity ?? ''} placeholder="order, product, staff…" maxLength={60} />
        <FormField name="entityId" label="ID объекта" defaultValue={filter.entityId ?? ''} maxLength={60} />
        <SelectField
          name="result"
          label="Результат"
          defaultValue={filter.result ?? ''}
          placeholder="Любой"
          options={[
            { value: 'ok', label: 'Успешно' },
            { value: 'denied', label: 'Отказ' },
            { value: 'error', label: 'Ошибка' },
          ]}
        />
      </FilterPanel>
      <DataTable
        caption="Журнал действий"
        columns={columns}
        rows={result.rows}
        rowKey={(r) => r.id}
        basePath="/admin/audit"
        params={sp}
        empty={{ title: 'Записей нет', description: 'Измените фильтры.' }}
        footer={<Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/audit" params={sp} />}
      />
    </>
  );
}
