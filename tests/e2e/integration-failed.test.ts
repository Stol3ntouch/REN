import { afterEach, describe, expect, it } from 'vitest';
import { setMailEnqueue } from '@/domain/admin/mail-enqueue';
import { createFileOnecPort } from '@/integrations/onec/file-stub';
import { runPushOrders } from '@/integrations/onec/service';
import { createTestDb, tmpData } from '../onec/helpers';

afterEach(() => setMailEnqueue(null));

describe('сбой обмена с 1С → письмо администратору', () => {
  it('запуск со статусом error ставит в очередь событие integration.failed без ПДн', async () => {
    const events: { event: string; payload: Record<string, unknown> }[] = [];
    setMailEnqueue((event, payload) => events.push({ event, payload }));
    const db = createTestDb();
    const port = createFileOnecPort({ dataDir: tmpData() });
    const res = await runPushOrders({ db, port, now: Date.UTC(2026, 9, 22) }, { orderNumber: 'RTS-999999' });
    expect(res.status).toBe('error');
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('integration.failed');
    expect(events[0]!.payload).toMatchObject({ integration: '1С' });
    expect(String(events[0]!.payload.message)).toContain('RTS-999999');
  });

  it('успешный запуск письма не шлёт', async () => {
    const events: string[] = [];
    setMailEnqueue((event) => events.push(event));
    const db = createTestDb();
    const port = createFileOnecPort({ dataDir: tmpData() });
    const res = await runPushOrders({ db, port, now: Date.UTC(2026, 9, 22) });
    expect(res.status).toBe('ok');
    expect(events).toEqual([]);
  });

  it('сбой постановки письма в очередь не ломает запуск', async () => {
    setMailEnqueue(() => {
      throw new Error('очередь недоступна');
    });
    const db = createTestDb();
    const port = createFileOnecPort({ dataDir: tmpData() });
    const res = await runPushOrders({ db, port, now: Date.UTC(2026, 9, 22) }, { orderNumber: 'RTS-999999' });
    expect(res.status).toBe('error');
  });
});
