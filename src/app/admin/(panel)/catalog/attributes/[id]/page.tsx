import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasPermission } from '@/domain/admin/permissions';
import { ATTRIBUTE_TYPE_LABELS } from '@/domain/catalog/attributes';
import { getDb } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { requireStaffPage } from '@/ui/admin/guard';
import { ConfirmButton, FlashToast, PageHeader, SelectField, type SearchParams } from '@/ui/admin/kit';
import { attributeOps } from '../../../_lib/attributes-ops';
import { AttributeForm } from '../AttributeForm';
import { deleteAttributeAction, mergeAttributesAction } from '../actions';

export const metadata: Metadata = { title: 'Характеристика' };
export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function AttributePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const session = await requireStaffPage('catalog.read');
  const id = Number((await params).id);
  const sp = await searchParams;
  const attr = Number.isInteger(id) && id > 0 ? attributeOps.get(session, id) : null;
  if (!attr) notFound();
  const canWrite = hasPermission(session.role, 'catalog.write');
  const db = getDb();
  const sameType = canWrite ? attributesRepo.listAll(db).filter((a) => a.id !== id && a.type === attr.type) : [];
  const hint =
    attr.type === 'string' && attr.suggestedType !== 'string' && attr.productCount > 0
      ? `Все значения (${attr.productCount} товаров) подходят под тип «${ATTRIBUTE_TYPE_LABELS[attr.suggestedType]}» — можно сменить тип.`
      : undefined;

  return (
    <>
      <FlashToast ok={one(sp.ok)} error={one(sp.error)} />
      <PageHeader title={attr.name} description={`Товаров со значением: ${attr.productCount}. Примеры: ${attr.examples.slice(0, 5).map((e) => e.value).join('; ') || '—'}`} />
      {canWrite ? <AttributeForm attribute={attr} categories={categoriesRepo.listAll(db)} {...(hint ? { hint } : {})} /> : <p className="ak-muted">Просмотр: редактирование доступно администратору.</p>}
      {canWrite ? (
        <>
          <section className="ak-card" aria-labelledby="attr-merge">
            <h2 id="attr-merge">Объединить с дублем</h2>
            <p>Значения этой характеристики перейдут к выбранной (того же типа), эта будет удалена.</p>
            <form action={mergeAttributesAction} className="ak-form-grid">
              <input type="hidden" name="id" value={id} />
              <SelectField name="targetId" label="Оставить характеристику" placeholder="Выберите" required options={sameType.map((a) => ({ value: String(a.id), label: a.name }))} />
              <ConfirmButton title="Объединить характеристики?" description="Значения будут перенесены, текущая характеристика удалена. Действие нельзя отменить." confirmLabel="Объединить" className="ak-btn ak-btn--outline">
                Объединить
              </ConfirmButton>
            </form>
          </section>
          <section className="ak-card" aria-labelledby="attr-del">
            <h2 id="attr-del">Удаление</h2>
            <form action={deleteAttributeAction}>
              <input type="hidden" name="id" value={id} />
              {attr.productCount > 0 ? <input type="hidden" name="withValues" value="1" /> : null}
              <ConfirmButton
                title={`Удалить «${attr.name}»?`}
                description={attr.productCount > 0 ? `Будут удалены и значения у товаров: ${attr.productCount}.` : 'Действие нельзя отменить.'}
                confirmLabel="Удалить"
              >
                {attr.productCount > 0 ? 'Удалить вместе со значениями' : 'Удалить характеристику'}
              </ConfirmButton>
            </form>
          </section>
        </>
      ) : null}
    </>
  );
}
