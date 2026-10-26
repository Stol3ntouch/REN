'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ValidationError } from '@/server/http/errors';
import { categoryOps, type ImageChange } from '../../_lib/category-ops';
import { categoryBulkOps, categoryTreeOps, type CategoryBulkAction, type CategoryBulkReport } from '../../_lib/category-tree-ops';
import { field, runAction, runStateAction, type StateResult } from '../../_lib/run-action';
import { categorySeoOps } from '../category-seo-ops';
import { categoryVisibilityOps } from '../category-visibility-ops';

const LIST = '/admin/catalog/categories';

/** Витрина кэшируется: после любого изменения категорий сбрасываем публичное. */
const revalidateShop = (): void => revalidatePath('/', 'layout');

const intField = (form: FormData, name: string, label: string): number => {
  const raw = field(form, name);
  const n = raw === '' ? NaN : Number(raw);
  if (!Number.isInteger(n)) throw new ValidationError(`${label}: целое число`, { [name]: [`${label}: целое число`] });
  return n;
};
const idOf = (form: FormData, name = 'id'): number => {
  const n = Number(field(form, name));
  if (!Number.isInteger(n) || n < 1) throw new ValidationError('Категория не найдена');
  return n;
};
const parentOf = (form: FormData, name = 'parentId'): number | null => (field(form, name) === '' ? null : idOf(form, name));

/** Адрес возврата: только внутренние пути раздела категорий (защита от открытого редиректа). */
function backOf(form: FormData, fallback: string): string {
  const back = field(form, 'back');
  return back.startsWith(LIST) && !back.startsWith('//') && !back.includes('\\') ? back : fallback;
}
const cardUrl = (id: number | string, tab?: string): string => `${LIST}?id=${id}${tab ? `&tab=${tab}` : ''}`;
const safeId = (form: FormData): number | string => {
  const n = Number(field(form, 'id'));
  return Number.isInteger(n) && n > 0 ? n : '';
};

async function imageOf(form: FormData): Promise<ImageChange> {
  const file = form.get('image');
  if (file instanceof File && file.size > 0) return { bytes: new Uint8Array(await file.arrayBuffer()) };
  return form.get('image_clear') === '1' ? { remove: true } : undefined;
}

// --- прежние действия (F2/F6): таблица видимости и SEO без JS остаются рабочими

export async function saveCategorySeoAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  const valid = Number.isInteger(id) && id > 0;
  return runAction(valid ? cardUrl(id, 'seo') : LIST, (session) => {
    if (!valid) throw new ValidationError('Категория не найдена');
    categorySeoOps.update(session, id, {
      seoTitle: field(form, 'seoTitle'),
      seoDescription: field(form, 'seoDescription'),
      h1: field(form, 'h1'),
      seoText: field(form, 'seoText'),
    });
  });
}

export async function setCategoryHiddenAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  const hidden = field(form, 'hidden') === '1';
  return runAction(LIST, (session) => {
    categoryVisibilityOps.setHidden(session, id, hidden);
    revalidateShop();
  });
}

// --- формы карточки (редирект с ?ok / ?error)

export async function createCategoryAction(form: FormData): Promise<never> {
  const parent = field(form, 'parentId');
  const failBack = parent === '' ? `${LIST}?new=1` : `${LIST}?new=1&parent=${encodeURIComponent(parent)}`;
  return runAction(failBack, (session) => {
    const { id } = categoryOps.create(session, { name: field(form, 'name'), parentId: parentOf(form), slug: field(form, 'slug') });
    revalidateShop();
    redirect(`${cardUrl(id)}&ok=1`); // успех — сразу в карточку новой категории
  });
}

export async function saveHeaderAction(form: FormData): Promise<never> {
  return runAction(backOf(form, cardUrl(safeId(form))), async (session) => {
    await categoryOps.updateHeader(
      session,
      idOf(form),
      {
        name: field(form, 'name'),
        slug: field(form, 'slug'),
        description: field(form, 'description'),
        active: form.get('active') === '1',
        sort: intField(form, 'sort', 'Позиция'),
        parentId: parentOf(form),
      },
      await imageOf(form),
    );
    revalidateShop();
  });
}

export async function saveSeoAction(form: FormData): Promise<never> {
  return runAction(cardUrl(safeId(form), 'seo'), (session) => {
    categoryOps.updateSeo(session, idOf(form), {
      seoTitle: field(form, 'seoTitle'),
      seoDescription: field(form, 'seoDescription'),
      h1: field(form, 'h1'),
      seoText: field(form, 'seoText'),
      slug: field(form, 'slug'),
      canonical: field(form, 'canonical'),
      indexable: form.get('indexable') === '1',
    });
    revalidateShop();
  });
}

export async function saveExtraAction(form: FormData): Promise<never> {
  return runAction(cardUrl(safeId(form), 'extra'), (session) => {
    categoryOps.updateExtra(session, idOf(form), {
      showInMenu: form.get('showInMenu') === '1',
      showOnHome: form.get('showOnHome') === '1',
      showInCatalog: form.get('showInCatalog') === '1',
      sort: intField(form, 'sort', 'Позиция сортировки'),
      priority: intField(form, 'priority', 'Приоритет'),
      code: field(form, 'code'),
      externalRef: field(form, 'externalRef'),
      adminComment: field(form, 'adminComment'),
      relatedIds: form.getAll('relatedIds').map((v) => Number(typeof v === 'string' ? v : NaN)),
    });
    revalidateShop();
  });
}

export async function saveFiltersAction(form: FormData): Promise<never> {
  return runAction(cardUrl(safeId(form), 'filters'), (session) => {
    const ids = form.getAll('filterId').map((v) => Number(typeof v === 'string' ? v : NaN));
    categoryOps.saveFilters(
      session,
      idOf(form),
      ids.map((filterId) => {
        const sort = field(form, `sort_${filterId}`);
        return { filterId, enabled: form.get(`enabled_${filterId}`) === '1', sort: sort === '' ? null : Number(sort) };
      }),
    );
    revalidateShop();
  });
}

export async function deleteCategoryAction(form: FormData): Promise<never> {
  return runAction(cardUrl(safeId(form)), (session) => {
    categoryOps.remove(session, idOf(form));
    revalidateShop();
    redirect(`${LIST}?ok=1`); // категории больше нет — к списку
  });
}

export async function addBannerAction(form: FormData): Promise<never> {
  return runAction(cardUrl(safeId(form), 'banners'), (session) => {
    categoryOps.addBanner(session, idOf(form), idOf(form, 'bannerId'));
    revalidateShop();
  });
}

export async function updateBannerAction(form: FormData): Promise<never> {
  return runAction(cardUrl(safeId(form), 'banners'), (session) => {
    categoryOps.updateBanner(session, idOf(form), idOf(form, 'bannerId'), { sort: intField(form, 'sort', 'Порядок'), enabled: form.get('enabled') === '1' });
    revalidateShop();
  });
}

export async function removeBannerAction(form: FormData): Promise<never> {
  return runAction(cardUrl(safeId(form), 'banners'), (session) => {
    categoryOps.removeBanner(session, idOf(form), idOf(form, 'bannerId'));
    revalidateShop();
  });
}

/** Массовое действие над флажками списка подкатегорий (форма работает и без JS). Итог — в ?done. */
export async function bulkSubcategoriesAction(form: FormData): Promise<never> {
  const back = backOf(form, LIST);
  const ids = form.getAll('ids').map((v) => Number(typeof v === 'string' ? v : NaN));
  const kind = field(form, 'bulk');
  return runAction(back, (session) => {
    const action: CategoryBulkAction = kind === 'move' ? { type: 'move', parentId: parentOf(form, 'moveTo') } : { type: kind === 'show' ? 'show' : 'hide' };
    const r = categoryBulkOps.run(session, ids, action);
    revalidateShop();
    const done = `Изменено: ${r.changed}, пропущено: ${r.skipped}${r.cascaded > 0 ? `, вложенных затронуто: ${r.cascaded}` : ''}`;
    redirect(`${back}${back.includes('?') ? '&' : '?'}ok=1&done=${encodeURIComponent(done)}`);
  });
}

// --- действия дерева (вызываются из клиента напрямую; ответ — состояние, без редиректа)

/** Глаз: visible = true — показать, false — скрыть. cascaded — сколько подкатегорий сменили видимость вместе с ней. */
export async function setCategoryVisibleAction(id: number, visible: boolean): Promise<StateResult<{ changed: boolean; cascaded: number }>> {
  return runStateAction((session) => {
    const impact = categoryVisibilityOps.impact(session, id, !visible);
    const { changed } = categoryVisibilityOps.setHidden(session, id, !visible);
    if (changed) revalidateShop();
    return { changed, cascaded: changed ? Math.max(0, impact.categories - 1) : 0 };
  });
}

export async function placeCategoryAction(id: number, parentId: number | null, beforeId: number | null): Promise<StateResult<{ changed: boolean }>> {
  return runStateAction((session) => {
    const r = categoryTreeOps.place(session, id, { parentId, beforeId });
    if (r.changed) revalidateShop();
    return r;
  });
}

export async function stepCategoryAction(id: number, direction: 'up' | 'down'): Promise<StateResult<{ changed: boolean }>> {
  return runStateAction((session) => {
    const r = categoryTreeOps.step(session, id, direction);
    if (r.changed) revalidateShop();
    return r;
  });
}

export async function bulkCategoriesAction(ids: number[], action: CategoryBulkAction): Promise<StateResult<CategoryBulkReport>> {
  return runStateAction((session) => {
    const r = categoryBulkOps.run(session, ids, action);
    if (r.changed > 0) revalidateShop();
    return r;
  });
}

export async function selectCategoryIdsAction(scope: { level: number | null } | { subtree: number }): Promise<StateResult<number[]>> {
  return runStateAction((session) => categoryBulkOps.selectionIds(session, scope));
}

/** Для переключателя «Показана на сайте» (kit Toggle): next = true — показать. Ответ в формате ToggleResult. */
export async function toggleCategoryVisibleAction(id: number, next: boolean): Promise<{ ok: boolean; message?: string }> {
  const r = await setCategoryVisibleAction(id, next);
  return r.ok ? { ok: true } : { ok: false, message: r.error };
}
