'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseProductFilter } from '@/domain/catalog/products-list';
import { ValidationError } from '@/server/http/errors';
import { productListOps, type BulkAction, type BulkReport, type BulkTarget } from '../../../_lib/product-list-ops';
import { productOps } from '../../../_lib/product-ops';
import { field, runAction, runStateAction } from '../../../_lib/run-action';
import { listBack as backOf, withParam } from './back';

const LIST = '/admin/catalog';

const listBack = (form: FormData): string => backOf(field(form, 'back'));

function productId(form: FormData): number {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Товар не найден');
  return id;
}

/** Страницы витрины могли закэшироваться. */
const revalidateShop = () => revalidatePath('/', 'layout');

/** Мгновенное сохранение переключателя «Опубликован»: Toggle откатывается, если вернулось {ok:false}. */
export async function togglePublishedAction(id: number, next: boolean): Promise<{ ok: boolean; message?: string }> {
  const r = await runStateAction((session) => productOps.setVisibility(session, id, { published: next }));
  if (!r.ok) return { ok: false, message: r.error };
  revalidateShop();
  return { ok: true };
}

/** Копия товара: скрыта, без остатка; открывается её карточка. */
export async function duplicateProductAction(form: FormData): Promise<never> {
  const back = listBack(form);
  const r = await runStateAction((session) => productListOps.duplicate(session, productId(form)));
  if (!r.ok) redirect(withParam(back, 'error', r.error));
  revalidatePath(LIST);
  redirect(`${LIST}/${r.data.id}?ok=1`);
}

/** Удаление одного товара (после подтверждения в интерфейсе). Правила C04: при заказах — отказ с подсказкой скрыть. */
export async function deleteProductAction(form: FormData): Promise<never> {
  return runAction(listBack(form), (session) => productOps.remove(session, productId(form)));
}

const FLAGS = { new: 'isNew', featured: 'featured', promo: 'isPromo' } as const;

function actionFrom(form: FormData): BulkAction {
  const op = field(form, 'op');
  const [kind, value] = op.split(':');
  if (kind === 'publish' || kind === 'unpublish' || kind === 'hide' || kind === 'show') return { type: kind };
  if (kind === 'move' || kind === 'addCategory') {
    const categoryId = Number(field(form, 'categoryId'));
    if (!Number.isInteger(categoryId) || categoryId < 1) throw new ValidationError('Выберите категорию');
    return { type: kind, categoryId };
  }
  if (kind === 'brand') {
    const raw = field(form, 'brandId');
    if (raw === '') throw new ValidationError('Выберите бренд или «Без бренда»');
    if (raw === 'none') return { type: 'brand', brandId: null };
    const brandId = Number(raw);
    if (!Number.isInteger(brandId) || brandId < 1) throw new ValidationError('Выберите бренд');
    return { type: 'brand', brandId };
  }
  if (kind && kind in FLAGS && (value === '1' || value === '0')) return { type: 'flag', flag: FLAGS[kind as keyof typeof FLAGS], value: value === '1' };
  throw new ValidationError('Выберите действие');
}

/** Выбранные строки либо «все по фильтру» (scope=filter): фильтр берётся из адреса страницы (qs), число — из подтверждения (expected). */
function targetFrom(form: FormData): BulkTarget {
  if (field(form, 'scope') === 'filter') {
    const filter = parseProductFilter(Object.fromEntries(new URLSearchParams(field(form, 'qs'))));
    return { filter, expectedTotal: Number(field(form, 'expected')) };
  }
  return { ids: form.getAll('ids').map((v) => Number(typeof v === 'string' ? v : NaN)) };
}

const summary = (r: BulkReport) => `Изменено: ${r.changed}, пропущено: ${r.skipped}, ошибок: ${r.errors.length}.`;

function finish(back: string, r: BulkReport): never {
  revalidateShop();
  const reasons = r.errors.slice(0, 3).map((e) => e.message).join('; ');
  const text = `${summary(r)}${reasons ? ` ${reasons}` : ''}`.slice(0, 400);
  redirect(withParam(withParam(back, 'ok', '1'), 'done', text));
}

/** Массовое изменение. Право products.write проверяет productListOps.bulk; Origin и сессию — runStateAction. */
export async function bulkProductsAction(form: FormData): Promise<never> {
  const back = listBack(form);
  const r = await runStateAction((session) => productListOps.bulk(session, actionFrom(form), targetFrom(form)));
  if (!r.ok) redirect(withParam(back, 'error', r.error));
  return finish(back, r.data);
}

/** Массовое удаление (только товары без заказов). Право products.delete. */
export async function bulkDeleteProductsAction(form: FormData): Promise<never> {
  const back = listBack(form);
  const r = await runStateAction((session) => productListOps.bulkRemove(session, targetFrom(form)));
  if (!r.ok) redirect(withParam(back, 'error', r.error));
  return finish(back, r.data);
}
