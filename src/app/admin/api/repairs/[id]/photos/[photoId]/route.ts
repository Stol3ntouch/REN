import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withStaffPermission } from '@/domain/admin/guard';
import { repairsOps } from '@/domain/requests/sales-admin';
import { NotFoundError, toErrorResponse } from '@/server/http/errors';

export const dynamic = 'force-dynamic';

const FILE_RE = /^[a-f0-9]{32}-\d{2,4}\.webp$/;
const uploadsDir = () => join(/*turbopackIgnore: true*/ process.env.DATA_DIR?.trim() || 'data', 'uploads');

/**
 * GET /admin/api/repairs/<заявка>/photos/<фото> — фото к заявке на ремонт. Право repair.write (сессия и Origin — в обёртке);
 * фото чужой заявки или несуществующее → 404, как и любое имя файла вне ожидаемого вида.
 */
export function GET(req: Request, ctx: { params: Promise<{ id: string; photoId: string }> }): Promise<Response> {
  return withStaffPermission('repair.write', async (_req, session) => {
    try {
      const { id, photoId } = await ctx.params;
      const photo = repairsOps.photoFile(session, Number(id), Number(photoId));
      if (!photo || !FILE_RE.test(photo.path)) throw new NotFoundError('Фото не найдено');
      const bytes = await readFile(join(/*turbopackIgnore: true*/ uploadsDir(), photo.path));
      return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } });
    } catch (e) {
      return toErrorResponse(e instanceof Error && 'code' in e && (e as { code?: string }).code === 'ENOENT' ? new NotFoundError('Фото не найдено') : e);
    }
  })(req);
}
