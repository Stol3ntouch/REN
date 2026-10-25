'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rublesToKopecks, type ProductInput } from '@/domain/catalog/products-admin';
import { ValidationError } from '@/server/http/errors';
import { productOps } from '../../_lib/product-ops';
import { field, runAction } from '../../_lib/run-action';

const LIST = '/admin/catalog';

function productId(form: FormData): number {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Товар не найден');
  return id;
}

function money(form: FormData, name: string, label: string): number | null | undefined {
  if (!form.has(name)) return undefined;
  const k = rublesToKopecks(field(form, name));
  if (Number.isNaN(k)) throw new ValidationError(`${label}: введите сумму в рублях, например 1990 или 1990,50`, { [name]: ['Неверная сумма'] });
  return k;
}

function count(form: FormData, name: string, label: string): number | undefined {
  const raw = field(form, name);
  if (raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new ValidationError(`${label}: нужно целое число`, { [name]: ['Нужно целое число'] });
  return n;
}

const flag = (form: FormData, name: string) => form.get(name) === 'on';

/** Поля формы карточки → вход productOps. Закупочная приходит только из формы тех, у кого есть право (ключ purchasePrice). */
function inputFromForm(form: FormData): ProductInput {
  const attributes: { attributeId: number; value: string }[] = [];
  for (const [key, value] of form.entries()) {
    const m = /^attr_(\d+)$/.exec(key);
    if (m && typeof value === 'string') attributes.push({ attributeId: Number(m[1]), value });
  }
  const price = money(form, 'price', 'Цена');
  const brand = field(form, 'brandId');
  const input: Record<string, unknown> = {
    name: field(form, 'name'),
    slug: field(form, 'slug'),
    sku: field(form, 'sku'),
    barcode: field(form, 'barcode'),
    shortDescription: field(form, 'shortDescription'),
    description: field(form, 'description') || null,
    categoryId: Number(field(form, 'categoryId')),
    extraCategoryIds: form.getAll('extraCategoryIds').map((v) => Number(typeof v === 'string' ? v : NaN)),
    brandId: brand === '' ? null : Number(brand),
    priceKopecks: price ?? Number.NaN,
    discountPriceKopecks: money(form, 'discountPrice', 'Скидочная цена') ?? null,
    oldPriceKopecks: money(form, 'oldPrice', 'Старая цена') ?? null,
    availability: field(form, 'availability') || 'auto',
    stockReason: field(form, 'stockReason'),
    published: flag(form, 'published'),
    hidden: flag(form, 'hidden'),
    featured: flag(form, 'featured'),
    isNew: flag(form, 'isNew'),
    isPromo: flag(form, 'isPromo'),
    seoTitle: field(form, 'seoTitle'),
    seoDescription: field(form, 'seoDescription'),
    canonicalUrl: field(form, 'canonicalUrl'),
    indexable: flag(form, 'indexable'),
    attributes,
  };
  const purchase = money(form, 'purchasePrice', 'Закупочная цена');
  if (purchase !== undefined) input.purchasePriceKopecks = purchase;
  const stock = count(form, 'stockQty', 'Остаток');
  if (stock !== undefined) input.stockQty = stock;
  const reserved = count(form, 'reservedQty', 'Резерв');
  if (reserved !== undefined) input.reservedQty = reserved;
  if (!Number.isFinite(input.priceKopecks as number)) input.priceKopecks = undefined;
  return input as ProductInput;
}

export async function createProductAction(form: FormData): Promise<never> {
  return runAction(`${LIST}/products/new`, async (session) => {
    const created = await productOps.create(session, inputFromForm(form));
    revalidatePath('/', 'layout');
    redirect(`${LIST}/${created.id}?ok=1`);
  });
}

export async function updateProductAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, async (session) => {
    await productOps.update(session, productId(form), inputFromForm(form));
    revalidatePath('/', 'layout');
  });
}

export async function setProductVisibilityAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, async (session) => {
    const patch: { published?: boolean; hidden?: boolean } = {};
    if (form.has('published')) patch.published = field(form, 'published') === '1';
    if (form.has('hidden')) patch.hidden = field(form, 'hidden') === '1';
    await productOps.setVisibility(session, productId(form), patch);
    revalidatePath('/', 'layout');
  });
}

export async function deleteProductAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, async (session) => {
    await productOps.remove(session, productId(form));
    revalidatePath('/', 'layout');
    redirect(`${LIST}?ok=1`);
  });
}

export async function uploadImagesAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, async (session) => {
    const files: { bytes: Uint8Array }[] = [];
    for (const f of form.getAll('images')) if (f instanceof File && f.size > 0) files.push({ bytes: new Uint8Array(await f.arrayBuffer()) });
    await productOps.addImages(session, productId(form), files);
    revalidatePath('/', 'layout');
  });
}

/** Действие над одним фото: main | up | down | remove | alt. */
export async function imageAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`${LIST}/${Number.isInteger(id) ? id : ''}`, async (session) => {
    const pid = productId(form);
    const imageId = Number(field(form, 'imageId'));
    if (!Number.isInteger(imageId) || imageId < 1) throw new ValidationError('Изображение не найдено');
    const op = field(form, 'op');
    if (op === 'main') await productOps.setMainImage(session, pid, imageId);
    else if (op === 'remove') await productOps.removeImage(session, pid, imageId);
    else if (op === 'alt') await productOps.setImageAlt(session, pid, imageId, field(form, 'alt'));
    else if (op === 'up' || op === 'down') {
      const ids = (productOps.get(session, pid)?.images ?? []).map((i) => i.id);
      const at = ids.indexOf(imageId);
      const to = op === 'up' ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= ids.length) return;
      [ids[at], ids[to]] = [ids[to] as number, ids[at] as number];
      await productOps.reorderImages(session, pid, ids);
    } else throw new ValidationError('Неизвестное действие');
    revalidatePath('/', 'layout');
  });
}
