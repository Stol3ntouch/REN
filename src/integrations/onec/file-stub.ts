import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { MAX_IMPORT_BYTES } from '@/importing/yml/types';
import type { PortStatus } from '../types';
import { OnecError, type CatalogBatch, type OneCPort, type OrderExport, type PushResult, type StatusUpdate } from './types';

export const INBOX_DIR = 'onec-inbox';
export const OUTBOX_DIR = 'onec-outbox';
export const STATUSES_FILE = 'statuses.json';

const ORDER_NUMBER_RE = /^RTS-\d{1,12}$/;

const STATUS_STUB: PortStatus = {
  connected: false,
  mode: 'stub',
  note: 'Не подключено — файловая заглушка: заказы пишутся в data/onec-outbox, каталог и статусы читаются из data/onec-inbox.',
};

const statusesSchema = z.array(
  z.object({
    orderNumber: z.string().min(1).max(40),
    status: z.string().min(1).max(40),
    updatedAt: z.union([z.string(), z.number()]),
  }),
);

export const hashOrderExport = (o: OrderExport): string => createHash('sha256').update(JSON.stringify(o)).digest('hex');

function toMs(v: string | number): number | null {
  const ms = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** Файловая заглушка 1С. Не выдаётся за подключённую: status() → connected=false, mode='stub'. */
export function createFileOnecPort(opts: { dataDir: string }): OneCPort {
  const inbox = join(opts.dataDir, INBOX_DIR);
  const outbox = join(opts.dataDir, OUTBOX_DIR);

  return {
    name: 'file',
    status: () => STATUS_STUB,

    async pullCatalog(): Promise<CatalogBatch> {
      let names: string[];
      try {
        names = readdirSync(inbox).filter((n) => /\.(yml|xml)$/i.test(n));
      } catch {
        return { fileName: null, xml: null };
      }
      const newest = names
        .map((n) => ({ n, t: statSync(join(inbox, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t || a.n.localeCompare(b.n))[0];
      if (!newest) return { fileName: null, xml: null };
      const full = join(inbox, newest.n);
      if (statSync(full).size > MAX_IMPORT_BYTES) throw new OnecError(`Файл ${newest.n} больше 20 МБ`);
      return { fileName: newest.n, xml: readFileSync(full, 'utf8') };
    },

    async pushOrder(order: OrderExport): Promise<PushResult> {
      if (!ORDER_NUMBER_RE.test(order.externalId) || order.externalId !== order.number) throw new OnecError('Недопустимый номер заказа для выгрузки');
      mkdirSync(outbox, { recursive: true });
      const file = join(outbox, `${order.externalId}.json`);
      const body = JSON.stringify(order, null, 2);
      try {
        writeFileSync(file, body, { encoding: 'utf8', flag: 'wx' }); // wx: существующий файл не трогаем
        return { externalId: order.externalId, created: true };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      let same = false;
      try {
        same = hashOrderExport(JSON.parse(readFileSync(file, 'utf8')) as OrderExport) === hashOrderExport(order);
      } catch {
        same = false;
      }
      return same ? { externalId: order.externalId, created: false } : { externalId: order.externalId, created: false, conflict: true };
    },

    async pullOrderStatuses(since: Date): Promise<StatusUpdate[]> {
      const file = join(inbox, STATUSES_FILE);
      let raw: string;
      try {
        raw = readFileSync(file, 'utf8');
      } catch {
        return [];
      }
      let parsed: z.infer<typeof statusesSchema>;
      try {
        parsed = statusesSchema.parse(JSON.parse(raw));
      } catch {
        throw new OnecError('Файл statuses.json повреждён или имеет неверный формат');
      }
      const out: StatusUpdate[] = [];
      for (const r of parsed) {
        const ms = toMs(r.updatedAt);
        if (ms === null) throw new OnecError(`statuses.json: неверная дата у заказа ${r.orderNumber}`);
        if (ms > since.getTime()) out.push({ orderNumber: r.orderNumber, status: r.status, updatedAt: ms });
      }
      return out;
    },
  };
}
