import { setMailEnqueue } from '@/domain/admin/mail-enqueue';
import { getDb } from '@/server/db/connection';
import { enqueueMailEvent } from './outbox';
import { mailSecrets, selectMailPort } from './ports';
import { processOutbox } from './worker';

type WorkerState = { timer?: ReturnType<typeof setInterval>; running?: boolean; connected?: boolean };
const state = ((globalThis as unknown as { __rtsMail?: WorkerState }).__rtsMail ??= {});

/** Один проход воркера; параллельные вызовы схлопываются. Ошибки наружу не выходят и не содержат ПДн. */
export async function runMailWorkerOnce(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    await processOutbox({ db: getDb(), port: selectMailPort(), secrets: mailSecrets() });
  } catch {
    console.error('[mail] проход очереди писем завершился ошибкой');
  } finally {
    state.running = false;
  }
}

/**
 * Подключает почту к приложению (вызвать один раз при старте сервера, в Node-runtime):
 *  1) enqueueMail(...) всего проекта начинает писать в email_outbox;
 *  2) фоновый воркер раз в intervalMs отправляет созревшие письма через MailPort (SMTP по env, иначе письма ждут).
 * Повторный вызов (HMR) не создаёт второй таймер.
 */
export function connectMail(o: { startWorker?: boolean; intervalMs?: number } = {}): void {
  setMailEnqueue((event, payload) => {
    try {
      enqueueMailEvent(getDb(), event, payload);
    } catch {
      // Заказ или заявка не должны падать из-за почты. В лог — только имя события.
      console.error(`[mail] не удалось поставить в очередь событие ${event}`);
      return;
    }
    if (state.timer) setTimeout(() => void runMailWorkerOnce(), 0).unref?.();
  });
  state.connected = true;
  if (o.startWorker === false || state.timer) return;
  state.timer = setInterval(() => void runMailWorkerOnce(), o.intervalMs ?? 30_000);
  state.timer.unref?.();
  void runMailWorkerOnce();
}

/** Остановить фоновый воркер (тесты, остановка сервера). */
export function stopMailWorker(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
}
