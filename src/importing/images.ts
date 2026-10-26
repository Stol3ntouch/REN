import { safeFetchImage } from '@/media/safe-fetch';
import { storeImage, type StoredImage } from '@/media/store-image';
import type { Db } from '@/server/db/connection';
import { imagesRepo } from '@/server/db/repositories/images';
import type { Issue } from './rows';

export type ImageDownloadOptions = {
  /** Скачивание; по умолчанию safeFetchImage (allowlist хостов, защита от SSRF). */
  fetchImage?: (url: string) => Promise<{ bytes: Uint8Array }>;
  /** Сохранение; по умолчанию storeImage (сигнатура, перекодирование, варианты). */
  storeImage?: (bytes: Uint8Array) => Promise<StoredImage>;
  concurrency?: number;
};

export type ImageDownloadResult = { stored: number; failed: number; errors: Issue[] };

/**
 * Скачивает ещё не скачанные фото указанных товаров. Только по явной галочке и только через safeFetchImage:
 * чужие хосты и внутренние адреса отклоняются. Сбой одного фото не влияет на остальные и ничего не откатывает.
 */
export async function downloadImages(db: Db, productIds: readonly number[], rowByProduct: ReadonlyMap<number, number>, o: ImageDownloadOptions = {}): Promise<ImageDownloadResult> {
  const fetchImage = o.fetchImage ?? ((url: string) => safeFetchImage(url));
  const store = o.storeImage ?? ((bytes: Uint8Array) => storeImage(bytes));
  const pending = imagesRepo.listPending(db, [...productIds]);
  const byUrl = new Map<string, Promise<StoredImage>>(); // один URL у нескольких товаров — одна загрузка
  const result: ImageDownloadResult = { stored: 0, failed: 0, errors: [] };
  let next = 0;
  const worker = async () => {
    for (;;) {
      const row = pending[next++];
      if (!row) return;
      try {
        let job = byUrl.get(row.urlSource);
        if (!job) {
          job = fetchImage(row.urlSource).then((r) => store(r.bytes));
          byUrl.set(row.urlSource, job);
        }
        const stored = await job;
        imagesRepo.setStored(db, row.id, { path: stored.path, variants: stored.variants });
        result.stored++;
      } catch (e) {
        result.failed++;
        result.errors.push({ row: rowByProduct.get(row.productId) ?? 0, field: 'images', message: `Фото ${row.urlSource.slice(0, 120)}: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  };
  const n = Math.max(1, Math.min(o.concurrency ?? 4, 16));
  await Promise.all(Array.from({ length: Math.min(n, pending.length) }, worker));
  return result;
}
