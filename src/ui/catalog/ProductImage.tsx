import type { CatalogImage } from '@/domain/catalog/types';
import { EmptyImage } from './EmptyImage';
import { SafeImage } from './SafeImage';

/** Фото товара или нейтральная заглушка (нет фото или оно не загрузилось). Внешние фото — обычный <img>: next/image требует настройки хостов. */
export function ProductImage({ image, name, priority = false, sizes }: { image: CatalogImage | null; name: string; priority?: boolean; sizes?: string }) {
  if (!image) return <EmptyImage name={name} />;
  return (
    <SafeImage
      src={image.src}
      alt={image.alt}
      width={image.width ?? 480}
      height={image.height ?? 480}
      name={name}
      sizes={sizes}
      loading={priority ? 'eager' : 'lazy'}
      referrerPolicy={image.remote ? 'no-referrer' : undefined}
    />
  );
}
