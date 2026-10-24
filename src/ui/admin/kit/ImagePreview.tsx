import type { ReactNode } from 'react';

/**
 * Превью изображения фиксированного размера с подписью и действиями (удалить, заменить).
 * `alt` обязателен: для декоративной картинки передайте '' явно.
 */
export function ImagePreview({ src, alt, width = 96, height = 96, caption, actions, fit = 'cover' }: { src: string; alt: string; width?: number; height?: number; caption?: ReactNode; actions?: ReactNode; fit?: 'cover' | 'contain' }) {
  return (
    <figure className="ak-preview">
      <div className="ak-preview__frame" style={{ width, height }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" style={{ objectFit: fit }} />
      </div>
      {caption ? <figcaption className="ak-preview__caption">{caption}</figcaption> : null}
      {actions ? <div className="ak-preview__actions">{actions}</div> : null}
    </figure>
  );
}
