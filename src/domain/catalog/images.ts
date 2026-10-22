import type { ImageRow } from '@/server/db/repositories/images';
import type { CatalogImage } from './types';

/** Базовый путь маршрута, раздающего загруженные фото из DATA_DIR/uploads. */
export const MEDIA_BASE = '/api/catalog/media';

export type ImageSize = 'thumb' | 'card' | 'large';
const FALLBACK_ORDER: Record<ImageSize, string[]> = {
  thumb: ['thumb', 'card', 'large', 'full'],
  card: ['card', 'large', 'thumb', 'full'],
  large: ['large', 'full', 'card', 'thumb'],
};

function mediaUrl(path: string): string {
  return `${MEDIA_BASE}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Локальная копия нужного размера, если фото скачано; иначе внешний URL источника.
 * Без выдуманных фото: если у товара нет ни строки, ни ссылки — вызывающий покажет заглушку.
 */
export function toCatalogImage(
  row: Pick<ImageRow, 'path' | 'variants' | 'urlSource' | 'alt'>,
  size: ImageSize,
  altFallback: string,
): CatalogImage {
  const alt = row.alt?.trim() || altFallback;
  if (row.path) {
    for (const key of FALLBACK_ORDER[size]) {
      const v = row.variants.find((x) => x.key === key);
      if (v) return { src: mediaUrl(v.path), alt, width: v.width, height: v.height, remote: false };
    }
    return { src: mediaUrl(row.path), alt, remote: false };
  }
  return { src: row.urlSource, alt, remote: true };
}
