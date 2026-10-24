'use client';

import { useState } from 'react';
import { EmptyImage } from './EmptyImage';

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  name: string;
  sizes?: string;
  loading: 'eager' | 'lazy';
  referrerPolicy?: 'no-referrer';
};

/**
 * Фото с запасом на случай ошибки: внешняя картинка (champion.ru) может не загрузиться — тогда вместо
 * alt-текста и «битого» значка показывается нейтральная иконка. Ошибку, случившуюся до гидратации,
 * ловит проверка complete/naturalWidth в ref-колбэке; позднюю — onError.
 */
export function SafeImage({ src, alt, width, height, name, sizes, loading, referrerPolicy }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <EmptyImage name={name} />;
  return (
    <span className="product-image">
      {/* eslint-disable-next-line @next/next/no-img-element -- внешние и локальные фото разных размеров, хосты не настроены для next/image */}
      <img
        ref={(el) => {
          if (el && el.complete && el.naturalWidth === 0) setFailedSrc(src);
        }}
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        loading={loading}
        decoding="async"
        referrerPolicy={referrerPolicy}
        onError={() => setFailedSrc(src)}
      />
    </span>
  );
}
