/** Выполняется один раз при старте сервера Next.js. Подключения — в src/server/startup.ts. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { connectApp } = await import('@/server/startup');
  connectApp();
}
