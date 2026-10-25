import { createHmac, timingSafeEqual } from 'node:crypto';
import { audit } from '@/domain/admin/audit';
import { ImageStoreError, storeImage } from '@/media';
import { getConfig } from '@/server/config';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { requestsRepo } from '@/server/db/repositories/requests';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';
import { enforceRateLimitByIp } from '@/server/http/rate-limit';
import { REPAIR_PHOTO_LIMIT } from './workflow';

const DEV_SECRET = 'rts-dev-repair-photo-secret-not-for-production';
/** Окно, в которое клиент может догрузить фото к только что созданной заявке. */
export const PHOTO_UPLOAD_WINDOW_MS = 60 * 60 * 1000;
export const PUBLIC_PHOTO_MAX_FILES = REPAIR_PHOTO_LIMIT;

function secret(explicit?: string): string {
  return explicit ?? getConfig().sessionSecret ?? DEV_SECRET;
}

/** Подпись «можно догрузить фото к этой заявке»: HMAC от номера. Выдаётся только создателю заявки в ответе формы. */
export function repairPhotoToken(number: string, explicitSecret?: string): string {
  return createHmac('sha256', secret(explicitSecret)).update(`repair-photo:${number}`).digest('base64url');
}

function verify(number: string, token: string, explicitSecret?: string): boolean {
  if (!token || token.length > 128) return false;
  const a = Buffer.from(repairPhotoToken(number, explicitSecret));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Фото к заявке на ремонт с сайта: номер + подпись из ответа формы, только в течение часа после создания, не больше 5 всего.
 * Содержимое проверяется в src/media (сигнатура JPEG/PNG/WebP, перекодирование, лимит размера). Любая ошибка доступа → 404.
 */
export async function submitRepairPhotos(
  input: { number: string; token: string; files: Uint8Array[] },
  ctx: { db?: Db; now?: number; ip: string; secret?: string; uploadsDir?: string },
): Promise<{ added: number }> {
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();
  enforceRateLimitByIp('form:repair-photos', ctx.ip, 30, 3600, { db, now });
  if (input.files.length === 0) throw new ValidationError('Выберите фото JPG, PNG или WebP');
  if (input.files.length > PUBLIC_PHOTO_MAX_FILES) throw new ValidationError(`Не больше ${PUBLIC_PHOTO_MAX_FILES} фото`);

  const row = db.prepare("SELECT id, created_at FROM requests WHERE number = ? AND kind = 'repair'").get(input.number) as { id: number; created_at: number } | undefined;
  if (!row || !verify(input.number, input.token, ctx.secret) || now - row.created_at > PHOTO_UPLOAD_WINDOW_MS) throw new NotFoundError('Заявка не найдена');
  if (requestsRepo.countPhotos(db, row.id) + input.files.length > REPAIR_PHOTO_LIMIT) throw new ConflictError(`К заявке можно приложить не больше ${REPAIR_PHOTO_LIMIT} фото`);

  const stored: Awaited<ReturnType<typeof storeImage>>[] = [];
  for (const bytes of input.files) {
    try {
      stored.push(await storeImage(bytes, ctx.uploadsDir ? { dir: ctx.uploadsDir } : {}));
    } catch (e) {
      if (e instanceof ImageStoreError) throw new ValidationError(e.message);
      throw e;
    }
  }
  withTransaction(db, () => {
    if (requestsRepo.countPhotos(db, row.id) + stored.length > REPAIR_PHOTO_LIMIT) throw new ConflictError(`К заявке можно приложить не больше ${REPAIR_PHOTO_LIMIT} фото`);
    for (const s of stored) {
      requestsRepo.insertPhoto(db, { requestId: row.id, path: s.path, width: s.width, height: s.height, position: requestsRepo.countPhotos(db, row.id), now });
    }
    requestsRepo.insertEvent(db, { requestId: row.id, at: now, kind: 'photo', actorType: 'customer', note: `Клиент приложил фото: ${stored.length}` });
    audit.record({ actorId: null, actorType: 'system', action: 'repair.photo', entity: 'repair', entityId: row.id, after: { added: stored.length, by: 'customer' } }, { db, now });
  });
  return { added: stored.length };
}
