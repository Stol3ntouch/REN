import { MEDIA_BASE, toCatalogImage, type ImageSize } from '@/domain/catalog/images';
import { parseVariants } from '@/domain/catalog/store';
import type { CatalogImage } from '@/domain/catalog/types';
import { ImageStoreError, storeImage } from '@/media/store-image';
import { ValidationError } from '@/server/http/errors';

/** Изображения контента: слайды, новости, услуги, акции, логотип. Приём — через storeImage (T02). */
export type ImageInput = { bytes?: Uint8Array | null; remove?: boolean };
export type StoredContentImage = { imagePath: string; imageVariants: string };

export { MEDIA_BASE };

/** Проверяет тип и размер, перекодирует в WebP и сохраняет; любая проблема файла — ValidationError с понятным текстом. */
export async function intakeImage(bytes: Uint8Array, dir?: string): Promise<StoredContentImage & { width: number; height: number }> {
  try {
    const stored = await storeImage(bytes, { dir });
    return { imagePath: stored.path, imageVariants: JSON.stringify(stored.variants), width: stored.width, height: stored.height };
  } catch (e) {
    if (e instanceof ImageStoreError) throw new ValidationError(e.message, { image: [e.message] });
    throw e;
  }
}

/** Картинка строки контента нужного размера или null, если фото нет. Alt — из строки, иначе запасной. */
export function imageView(
  row: { imagePath: string | null; imageVariants: string | null; imageAlt: string | null },
  size: ImageSize,
  altFallback: string,
): CatalogImage | null {
  if (!row.imagePath) return null;
  return toCatalogImage({ path: row.imagePath, variants: parseVariants(row.imageVariants), urlSource: '', alt: row.imageAlt }, size, altFallback);
}
