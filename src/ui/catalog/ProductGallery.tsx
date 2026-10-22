'use client';

import { useState } from 'react';
import type { CatalogImage } from '@/domain/catalog/types';
import { ProductImage } from './ProductImage';

/** Галерея карточки: крупное фото и миниатюры (кнопки с подписями). Нет фото — нейтральная заглушка. */
export function ProductGallery({ images, thumbs, name }: { images: CatalogImage[]; thumbs: CatalogImage[]; name: string }) {
  const [index, setIndex] = useState(0);
  const current = images[index] ?? null;
  return (
    <div className="gallery">
      <div className="gallery__main">
        <ProductImage key={current?.src ?? 'none'} image={current} name={name} priority sizes="(min-width: 48rem) 28rem, 100vw" />
      </div>
      {images.length > 1 ? (
        <ul className="gallery__thumbs" aria-label="Фотографии товара">
          {thumbs.map((t, i) => (
            <li key={`${t.src}-${i}`}>
              <button
                type="button"
                className="gallery__thumb"
                aria-label={`Фото ${i + 1} из ${thumbs.length}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => setIndex(i)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- миниатюры локальные или внешние, размеры заданы */}
                <img src={t.src} alt="" width={t.width ?? 160} height={t.height ?? 160} loading="lazy" decoding="async" referrerPolicy={t.remote ? 'no-referrer' : undefined} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
