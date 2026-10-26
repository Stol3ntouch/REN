import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { backupAdmin } from '@/domain/admin/backup';
import { withStaffPermission } from '@/domain/admin/guard';

export const dynamic = 'force-dynamic';

/**
 * GET /admin/api/backup/download?token=… — скачивание копии по одноразовой ссылке (5 минут, только выдавшему её сотруднику с правом backup.run).
 * Путь на диске не раскрывается, имя файла — rts-backup-*.tar.gz из таблицы backups.
 */
export const GET = withStaffPermission('backup.run', (req, session) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const { file, downloadName, size } = backupAdmin.consumeDownload(session, token);
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      'content-type': 'application/gzip',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${downloadName}"`,
      'cache-control': 'no-store',
    },
  });
});
