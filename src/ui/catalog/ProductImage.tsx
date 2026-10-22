import type { CatalogImage } from '@/domain/catalog/types';

/** Фото товара или нейтральная заглушка. Внешние фото — обычный <img>: next/image требует настройки хостов. */
export function ProductImage({ image, name, priority = false, sizes }: { image: CatalogImage | null; name: string; priority?: boolean; sizes?: string }) {
  if (!image) {
    return (
      <span className="product-image product-image--empty" role="img" aria-label={`Фото товара «${name}» отсутствует`}>
        <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" focusable="false">
          <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01" />
        </svg>
      </span>
    );
  }
  return (
    <span className="product-image">
      {/* eslint-disable-next-line @next/next/no-img-element -- внешние и локальные фото разных размеров, хосты не настроены для next/image */}
      <img
        src={image.src}
        alt={image.alt}
        width={image.width ?? 480}
        height={image.height ?? 480}
        sizes={sizes}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy={image.remote ? 'no-referrer' : undefined}
      />
    </span>
  );
}
