/** Выполняется один раз при старте сервера Next.js. Подключения — в src/server/startup.ts. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // C12: запрошенное в админке восстановление из копии применяется ДО открытия БД (файл БД у живого процесса не заменить).
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    try {
      const { applyPendingRestoreAtStart } = await import('@/domain/admin/backup');
      const note = await applyPendingRestoreAtStart();
      if (note) console.warn(`[backup] ${note}`);
    } catch {
      console.error('[backup] не удалось проверить запрос на восстановление');
    }
  }
  const { connectApp } = await import('@/server/startup');
  connectApp();
}
