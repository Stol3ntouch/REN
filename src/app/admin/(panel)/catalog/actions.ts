'use server';

import { parseRubles } from '@/domain/pricing/format';
import { ValidationError } from '@/server/http/errors';
import { catalogOps } from '../_lib/catalog-ops';
import { field, runAction } from '../_lib/run-action';

function productId(form: FormData): number {
  const id = Number(field(form, 'id'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Товар не найден');
  return id;
}

function money(form: FormData, name: string, label: string): number | null {
  const raw = field(form, name);
  if (raw === '') return null;
  const k = parseRubles(raw);
  if (k === null) throw new ValidationError(`${label}: введите сумму в рублях, например 1990 или 1990,50`, { [name]: ['Неверная сумма'] });
  return k;
}

/** Сохранение карточки товара. Право catalog.write и флаг catalog.manualEdit проверяет catalogOps.update на сервере. */
export async function saveProductAction(form: FormData): Promise<never> {
  const id = (() => {
    try {
      return productId(form);
    } catch {
      return 0;
    }
  })();
  return runAction(id ? `/admin/catalog/${id}` : '/admin/catalog', (session) => {
    const price = money(form, 'price', 'Цена');
    if (price === null) throw new ValidationError('Укажите цену', { price: ['Укажите цену'] });
    catalogOps.update(session, productId(form), {
      priceKopecks: price,
      discountPriceKopecks: money(form, 'discountPrice', 'Скидочная цена'),
      published: form.get('published') === 'on',
      featured: form.get('featured') === 'on',
      description: field(form, 'description') || null,
      seoTitle: field(form, 'seoTitle') || null,
      seoDescription: field(form, 'seoDescription') || null,
    });
  });
}

/** Вернуть выбранные поля под управление импорта. */
export async function unlockFieldsAction(form: FormData): Promise<never> {
  const id = Number(field(form, 'id'));
  return runAction(`/admin/catalog/${Number.isInteger(id) ? id : ''}`, (session) => {
    const fields = form.getAll('fields').filter((v): v is string => typeof v === 'string');
    catalogOps.unlock(session, productId(form), fields);
  });
}
