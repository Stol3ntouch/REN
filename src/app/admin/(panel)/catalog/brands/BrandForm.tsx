import { MEDIA_BASE } from '@/domain/catalog/images';
import type { BrandRow } from '@/server/db/repositories/brands';
import { FileUploader, FormField, SaveBar, TextAreaField, UnsavedChangesGuard } from '@/ui/admin/kit';
import { createBrandAction, updateBrandAction } from './actions';

const logoSrc = (b: BrandRow | null): string | null => (b?.logoPath ? `${MEDIA_BASE}/${encodeURIComponent(b.logoPath)}` : null);

/** Форма бренда (создание и правка): серверное действие, логотип уходит вместе с формой (multipart). */
export function BrandForm({ brand }: { brand: BrandRow | null }) {
  return (
    <form id="brand-form" action={brand ? updateBrandAction : createBrandAction} encType="multipart/form-data" className="ak-card ak-form-grid">
      <UnsavedChangesGuard formId="brand-form" />
      {brand ? <input type="hidden" name="id" value={brand.id} /> : null}
      <FormField name="name" label="Название" required maxLength={120} defaultValue={brand?.name ?? ''} />
      <FormField name="slug" label="Slug" maxLength={100} defaultValue={brand?.slug ?? ''} hint="Латиница, цифры и дефисы. Пусто — из названия." />
      <FormField name="siteUrl" label="Сайт производителя" type="url" maxLength={300} defaultValue={brand?.siteUrl ?? ''} placeholder="https://" />
      <FormField name="sort" label="Позиция сортировки" type="number" step={1} defaultValue={brand?.sort ?? 0} />
      <TextAreaField name="description" label="Описание" rows={5} maxLength={5000} defaultValue={brand?.description ?? ''} />
      <FileUploader name="logo" label="Логотип" value={logoSrc(brand)} alt={brand ? `Логотип ${brand.name}` : ''} maxBytes={2 * 1024 * 1024} hint="JPG, PNG или WebP до 2 МБ; содержимое проверяется на сервере." />
      <FormField name="seoTitle" label="SEO Title" maxLength={200} defaultValue={brand?.seoTitle ?? ''} />
      <TextAreaField name="seoDescription" label="SEO Description" rows={3} maxLength={500} defaultValue={brand?.seoDescription ?? ''} />
      <label className="ak-check">
        <input type="checkbox" name="published" defaultChecked={brand?.published ?? true} /> Опубликован на сайте
      </label>
      <SaveBar cancelHref="/admin/catalog/brands" />
    </form>
  );
}
