import { describe, expect, it } from 'vitest';
import { overviewOps } from '@/app/admin/(panel)/_lib/overview-ops';
import { integrationRunsRepo } from '@/server/db/repositories/integration-runs';
import { UnauthorizedError } from '@/server/http/errors';
import { createTestDb } from '@/server/db/testing';
import { ms, seedOctober } from '../analytics/helpers';
import { admin, manager } from './helpers';

const RANGE = { from: ms('2026-10-01T00:00:00+03:00'), to: ms('2026-11-01T00:00:00+03:00') };
const NOW = ms('2026-10-22T12:00:00+03:00');

describe('Обзор', () => {
  it('админ видит выручку, средний чек и динамику, совпадающие с набором заказов', () => {
    const db = createTestDb();
    seedOctober(db);
    const v = overviewOps.get(admin, RANGE, 'day', { db, now: NOW });
    expect(v.empty).toBe(false);
    expect(v.orders).toEqual({ counted: 3, created: 5 });
    expect(v.money).toMatchObject({ revenueKopecks: 400_000, averageCheckKopecks: 200_000 });
    expect(v.series?.map((r) => r.bucket)).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('менеджер видит число заказов, но не выручку и не динамику выручки', () => {
    const db = createTestDb();
    seedOctober(db);
    const v = overviewOps.get(manager, RANGE, 'day', { db, now: NOW });
    expect(v.orders).toEqual({ counted: 3, created: 5 });
    expect(v.money).toBeNull();
    expect(v.series).toBeNull();
    expect(JSON.stringify(v)).not.toContain('400000');
  });

  it('пустой период: empty=true; заявки недоступны (таблиц нет) → available=false; ошибки интеграций считаются', () => {
    const db = createTestDb();
    const id = integrationRunsRepo.start(db, { kind: 'onec.pull_catalog', actor: 'system', now: NOW - 1000 });
    integrationRunsRepo.finish(db, id, { status: 'error', counts: {}, errors: ['x'], now: NOW });
    const v = overviewOps.get(admin, RANGE, 'day', { db, now: NOW });
    expect(v.empty).toBe(true);
    expect(v.requests.available).toBe(false);
    expect(v.attention?.failedRuns7d).toBe(1);
  });

  it('аноним → 401', () => {
    expect(() => overviewOps.get(null, RANGE, 'day', { db: createTestDb(), now: NOW })).toThrow(UnauthorizedError);
  });
});
