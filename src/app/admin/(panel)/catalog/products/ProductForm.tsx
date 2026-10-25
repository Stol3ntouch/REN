import Link from 'next/link';
import { MEDIA_BASE } from '@/domain/catalog/images';
import { AVAILABILITY_LABELS } from '@/domain/catalog/products-admin';
import type { AttributeDef } from '@/server/db/repositories/attributes';
import type { StockMovementRow } from '@/server/db/repositories/stock';
import { ConfirmButton, FormField, SaveBar, SelectField, TextAreaField, UnsavedChangesGuard } from '@/ui/admin/kit';
import type { ProductForm as ProductData } from '../../_lib/product-ops';
import { createProductAction, deleteProductAction, imageAction, setProductVisibilityAction, updateProductAction, uploadImagesAction } from './actions';
import { ProductTabs } from './ProductTabs';

type Options = {
  categories: { id: number; label: string }[];
  brands: { id: number; name: string }[];
  attributes: AttributeDef[];
};

const rub = (k: number | null | undefined): string => (k === null || k === undefined ? '' : k % 100 === 0 ? String(k / 100) : (k / 100).toFixed(2).replace('.', ','));
const dateText = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('ru-RU') : '—');

function imageSrc(i: ProductData['images'][number]): string {
  if (!i.path) return i.urlSource;
  const v = i.variants.find((x) => x.key === 'card') ?? i.variants[0];
  return `${MEDIA_BASE}/${encodeURIComponent(v?.path ?? i.path)}`;
}

function AttributeInput({ def, value }: { def: AttributeDef; value: string }) {
  const name = `attr_${def.id}`;
  const label = def.unit ? `${def.name}, ${def.unit}` : def.name;
  const common = { name, label: def.required ? `${label} *` : label };
  if (def.type === 'list') {
    return <SelectField {...common} defaultValue={value} placeholder={def.required ? 'Выберите значение' : '— не задано —'} options={def.allowedValues.map((v) => ({ value: v, label: v }))} />;
  }
  if (def.type === 'boolean') {
    return <SelectField {...common} defaultValue={value} placeholder="— не задано —" options={[{ value: 'Да', label: 'Да' }, { value: 'Нет', label: 'Нет' }]} />;
  }
  return <FormField {...common} type={def.type === 'date' ? 'date' : 'text'} inputMode={def.type === 'number' ? 'decimal' : undefined} maxLength={500} defaultValue={value} />;
}

/**
 * Карточка товара: создание (product = null) и правка. Одна форма, шесть вкладок. Фото — отдельные формы вне основной
 * (вложенные формы недопустимы), поэтому вкладка «Изображения» есть только у сохранённого товара.
 */
export function ProductFormView({
  product,
  options,
  canWrite,
  canCost,
  canDelete,
  history,
}: {
  product: ProductData | null;
  options: Options;
  canWrite: boolean;
  canCost: boolean;
  canDelete: boolean;
  history: StockMovementRow[];
}) {
  const values = new Map((product?.attributes ?? []).map((a) => [a.attributeId, a.value]));
  const tabs = [
    { key: 'main', label: 'Основное' },
    { key: 'prices', label: 'Цены и склад' },
    { key: 'categories', label: 'Категории и бренд' },
    { key: 'attributes', label: 'Характеристики' },
    ...(product ? [{ key: 'images', label: `Изображения (${product.images.length})` }] : []),
    { key: 'seo', label: 'SEO' },
  ];
  const stock = product?.stock;

  return (
    <ProductTabs tabs={tabs}>
      <form id="product-form" action={product ? updateProductAction : createProductAction} className="ak-card ak-form-grid">
        <UnsavedChangesGuard formId="product-form" />
        {product ? <input type="hidden" name="id" value={product.id} /> : null}
        <fieldset disabled={!canWrite} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '1rem' }}>
          <section data-panel="main" id="ppanel-main" role="tabpanel" aria-labelledby="ptab-main" className="ak-form-grid">
            <FormField name="name" label="Название" required maxLength={300} defaultValue={product?.name ?? ''} />
            <div className="pf__grid">
              <FormField name="slug" label="Slug (адрес)" maxLength={100} defaultValue={product?.slug ?? ''} hint="Латиница, цифры и дефисы. Пусто — из названия." />
              <FormField name="sku" label="Артикул (SKU)" maxLength={100} defaultValue={product?.sku ?? ''} />
              <FormField name="barcode" label="Штрихкод" maxLength={64} defaultValue={product?.barcode ?? ''} />
            </div>
            <TextAreaField name="shortDescription" label="Краткое описание" rows={3} maxLength={500} defaultValue={product?.shortDescription ?? ''} />
            <TextAreaField name="description" label="Полное описание" rows={10} maxLength={20000} defaultValue={product?.description ?? ''} hint="Безопасный HTML: абзацы, списки, выделение; остальное будет удалено." />
            <div className="pf__flags">
              <label className="ak-check"><input type="checkbox" name="published" defaultChecked={product?.published ?? true} /> Опубликован</label>
              <label className="ak-check"><input type="checkbox" name="hidden" defaultChecked={product?.hidden ?? false} /> Скрыт администратором</label>
              <label className="ak-check"><input type="checkbox" name="featured" defaultChecked={product?.featured ?? false} /> Рекомендуемый</label>
              <label className="ak-check"><input type="checkbox" name="isNew" defaultChecked={product?.isNew ?? false} /> Новинка</label>
              <label className="ak-check"><input type="checkbox" name="isPromo" defaultChecked={product?.isPromo ?? false} /> Акционный</label>
            </div>
            {product ? (
              <p className="pf__meta">
                Создан: {dateText(product.createdAt)} · Изменён: {dateText(product.updatedAt)} · Источник: {product.source}
              </p>
            ) : null}
          </section>

          <section data-panel="prices" id="ppanel-prices" role="tabpanel" aria-labelledby="ptab-prices" className="ak-form-grid">
            <div className="pf__grid">
              <FormField name="price" label="Цена, ₽" required inputMode="decimal" defaultValue={rub(product?.priceKopecks)} />
              <FormField name="discountPrice" label="Скидочная цена, ₽" inputMode="decimal" defaultValue={rub(product?.discountPriceKopecks)} hint="Меньше обычной цены." />
              <FormField name="oldPrice" label="Старая цена, ₽" inputMode="decimal" defaultValue={rub(product?.oldPriceKopecks)} hint="Больше цены к оплате; покажет «−N %»." />
              {canCost ? <FormField name="purchasePrice" label="Закупочная цена, ₽" inputMode="decimal" defaultValue={rub(product?.purchasePriceKopecks)} hint="Видна только сотрудникам с правом на закупочные цены." /> : null}
            </div>
            <div className="pf__grid">
              <SelectField
                name="availability"
                label="Наличие"
                defaultValue={product?.availabilityMode === 'manual' ? product.availability : 'auto'}
                options={[{ value: 'auto', label: 'Авто (по остатку)' }, ...Object.entries(AVAILABILITY_LABELS).map(([value, label]) => ({ value, label }))]}
                hint="Публикация от наличия не зависит."
              />
              <FormField name="stockQty" label="Остаток, шт." type="number" min={0} step={1} defaultValue={stock && stock.tracked ? stock.stockQty : ''} hint={stock && !stock.tracked ? 'Остаток не ведётся: количество неизвестно.' : undefined} />
              <FormField name="reservedQty" label="Резерв, шт." type="number" min={0} step={1} defaultValue={stock && stock.tracked ? stock.reservedQty : ''} hint="Не больше остатка." />
              <FormField name="stockReason" label="Причина изменения остатка" maxLength={300} hint="Обязательна, если меняете остаток или резерв." />
            </div>
            {stock?.tracked ? <p className="pf__meta">Свободно: {stock.availableQty} шт.</p> : null}
            {product ? (
              <div>
                <h3>История остатка</h3>
                {history.length === 0 ? (
                  <p className="ak-muted">Операций с остатком пока не было.</p>
                ) : (
                  <div className="ak-tablewrap">
                    <table className="ak-table">
                      <caption className="visually-hidden">История операций с остатком</caption>
                      <thead>
                        <tr><th scope="col">Дата</th><th scope="col">Изменение</th><th scope="col">Остаток</th><th scope="col">Резерв</th><th scope="col">Причина</th></tr>
                      </thead>
                      <tbody>
                        {history.map((m) => (
                          <tr key={m.id}>
                            <td>{dateText(m.createdAt)}</td>
                            <td>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                            <td>{m.qtyAfter}</td>
                            <td>{m.reservedAfter}{m.reservedDelta !== 0 ? ` (${m.reservedDelta > 0 ? '+' : ''}${m.reservedDelta})` : ''}</td>
                            <td>{m.reason}{m.ref ? ` · ${m.ref}` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <section data-panel="categories" id="ppanel-categories" role="tabpanel" aria-labelledby="ptab-categories" className="ak-form-grid">
            <SelectField name="categoryId" label="Основная категория" required defaultValue={product ? String(product.categoryId) : ''} placeholder="Выберите категорию" options={options.categories.map((c) => ({ value: String(c.id), label: c.label }))} />
            <fieldset>
              <legend>Дополнительные категории</legend>
              <div className="pf__cats">
                {options.categories.map((c) => (
                  <label key={c.id} className="ak-check">
                    <input type="checkbox" name="extraCategoryIds" value={c.id} defaultChecked={product?.extraCategoryIds.includes(c.id) ?? false} /> {c.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <SelectField name="brandId" label="Бренд" defaultValue={product?.brandId ? String(product.brandId) : ''} placeholder="— без бренда —" options={options.brands.map((b) => ({ value: String(b.id), label: b.name }))} />
          </section>

          <section data-panel="attributes" id="ppanel-attributes" role="tabpanel" aria-labelledby="ptab-attributes" className="ak-form-grid">
            {options.attributes.length === 0 ? (
              <p className="ak-muted">Характеристик пока нет. Создайте их в разделе «Каталог → Характеристики».</p>
            ) : (
              <div className="pf__grid">
                {options.attributes.map((d) => (
                  <AttributeInput key={d.id} def={d} value={values.get(d.id) ?? ''} />
                ))}
              </div>
            )}
          </section>

          <section data-panel="seo" id="ppanel-seo" role="tabpanel" aria-labelledby="ptab-seo" className="ak-form-grid">
            <FormField name="seoTitle" label="SEO Title" maxLength={200} defaultValue={product?.seoTitle ?? ''} />
            <TextAreaField name="seoDescription" label="SEO Description" rows={3} maxLength={500} defaultValue={product?.seoDescription ?? ''} />
            <FormField name="canonicalUrl" label="Canonical" type="url" maxLength={500} defaultValue={product?.canonicalUrl ?? ''} placeholder="https://" hint="Пусто — адрес самого товара." />
            <label className="ak-check"><input type="checkbox" name="indexable" defaultChecked={product?.indexable ?? true} /> Разрешить индексацию поисковиками</label>
          </section>
        </fieldset>
        {canWrite ? <SaveBar cancelHref="/admin/catalog" saveLabel={product ? 'Сохранить изменения' : 'Создать товар'} /> : null}
      </form>

      {product ? (
        <section data-panel="images" id="ppanel-images" role="tabpanel" aria-labelledby="ptab-images" className="ak-card">
          {canWrite ? (
            <form action={uploadImagesAction} encType="multipart/form-data" className="ak-form-grid">
              <input type="hidden" name="id" value={product.id} />
              <label className="ak-field__label" htmlFor="pf-images">Добавить фото (JPG, PNG, WebP, до 5 МБ каждое)</label>
              <input id="pf-images" name="images" type="file" multiple accept="image/jpeg,image/png,image/webp" required />
              <button type="submit" className="ak-btn ak-btn--primary">Загрузить</button>
            </form>
          ) : null}
          {product.images.length === 0 ? (
            <p className="ak-muted">Фотографий нет.</p>
          ) : (
            <ul className="pf__images">
              {product.images.map((img, i) => (
                <li key={img.id} className="pf__image">
                  {/* eslint-disable-next-line @next/next/no-img-element -- локальные варианты или внешняя ссылка импорта */}
                  <img src={imageSrc(img)} alt={img.alt ?? product.name} loading="lazy" referrerPolicy={img.path ? undefined : 'no-referrer'} />
                  <p className="pf__meta">{i === 0 ? 'Главное' : `Фото ${i + 1}`}{img.path ? '' : ' · внешняя ссылка'}</p>
                  {canWrite ? (
                    <>
                      <form action={imageAction} className="pf__image-actions">
                        <input type="hidden" name="id" value={product.id} />
                        <input type="hidden" name="imageId" value={img.id} />
                        {i > 0 ? <button type="submit" name="op" value="main" className="ak-btn ak-btn--sm">Сделать главным</button> : null}
                        {i > 0 ? <button type="submit" name="op" value="up" className="ak-btn ak-btn--sm" aria-label="Выше">↑</button> : null}
                        {i < product.images.length - 1 ? <button type="submit" name="op" value="down" className="ak-btn ak-btn--sm" aria-label="Ниже">↓</button> : null}
                        <ConfirmButton name="op" value="remove" title="Удалить фото?" confirmLabel="Удалить" className="ak-btn ak-btn--sm ak-btn--danger-outline">Удалить</ConfirmButton>
                      </form>
                      <form action={imageAction} className="pf__image-actions">
                        <input type="hidden" name="id" value={product.id} />
                        <input type="hidden" name="imageId" value={img.id} />
                        <input type="hidden" name="op" value="alt" />
                        <input name="alt" aria-label="Подпись (alt)" placeholder="Подпись (alt)" maxLength={200} defaultValue={img.alt ?? ''} />
                        <button type="submit" className="ak-btn ak-btn--sm">Сохранить</button>
                      </form>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {product && canWrite ? (
        <section className="ak-card" aria-labelledby="pf-danger">
          <h2 id="pf-danger">Видимость и удаление</h2>
          <form action={setProductVisibilityAction} className="ak-inline">
            <input type="hidden" name="id" value={product.id} />
            <input type="hidden" name="hidden" value={product.hidden ? '0' : '1'} />
            <button type="submit" className="ak-btn ak-btn--outline">{product.hidden ? 'Показать на сайте' : 'Скрыть с сайта'}</button>
          </form>
          {canDelete ? (
            <form action={deleteProductAction} className="ak-inline">
              <input type="hidden" name="id" value={product.id} />
              <ConfirmButton title={`Удалить товар «${product.name}»?`} description="Будут удалены связи с категориями, характеристики, фото, остатки, избранное и корзины. Если товар есть в заказах, удаление невозможно — скройте его." confirmLabel="Удалить">
                Удалить товар
              </ConfirmButton>
            </form>
          ) : null}
        </section>
      ) : null}
      {!canWrite ? (
        <p className="ak-muted">
          Просмотр: редактирование доступно администратору. <Link href="/admin/catalog">К списку товаров</Link>
        </p>
      ) : null}
    </ProductTabs>
  );
}
