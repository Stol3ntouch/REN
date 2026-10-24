import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStaffSession } from '@/domain/admin/staff-session';
import { audit } from '@/domain/admin/audit';
import { maskPii } from '@/domain/admin/mask';
import { createUserSession, sessionCookieOptions } from '@/domain/customers/session';
import { trustProxyWarning } from '@/server/config';
import { setMailEnqueue } from '@/domain/admin/mail-enqueue';
import { setPopularitySource } from '@/domain/catalog/popularity';
import { stopMailWorker } from '@/integrations/mail';
import { setPaymentRunLogger } from '@/integrations/payment/service';
import { connectApp } from '@/server/startup';
import { createTestDb } from '@/server/db/testing';
import { fakeCookies } from '../auth/helpers';

describe('Secure-cookie берётся из isProductionEnv', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('APP_ENV=production без NODE_ENV: cookie покупателя и сотрудника secure', () => {
    vi.stubEnv('NODE_ENV', '');
    vi.stubEnv('APP_ENV', 'production');
    const db = createTestDb();
    db.prepare("INSERT INTO users (id,email,password_hash,created_at) VALUES (1,'a@b.ru','x',1)").run();
    db.prepare("INSERT INTO staff (id,email,password_hash,role_id,active,created_at) VALUES (1,'boss','x',(SELECT id FROM roles WHERE code = 'admin'),1,1)").run();
    const user = fakeCookies();
    createUserSession(user, 1, { db, now: 1 });
    expect(user.sets[0]?.options?.secure).toBe(true);
    const staff = fakeCookies();
    createStaffSession(staff, 1, { db, now: 1 });
    expect(staff.sets[0]?.options?.secure).toBe(true);
    expect(sessionCookieOptions(10, 'strict').secure).toBe(true);
  });

  it('вне production secure выключен', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_ENV', '');
    expect(sessionCookieOptions(10).secure).toBe(false);
  });
});

describe('маскирование секретов в аудите', () => {
  it('значения под секретными ключами скрыты на любой глубине', () => {
    const masked = JSON.stringify(
      maskPii({ after: { passwordHash: 'SECRETX', nested: { token: 'SECRETY', list: [{ Authorization: 'SECRETZ', cookie: 'SECRETC' }] }, name: 'ok' } }),
    );
    for (const s of ['SECRETX', 'SECRETY', 'SECRETZ', 'SECRETC']) expect(masked).not.toContain(s);
    expect(masked).toContain('[скрыто]');
    expect(masked).toContain('"name":"ok"');
  });

  it('audit.record не пишет секреты в журнал', () => {
    const db = createTestDb();
    audit.record(
      { actorId: 1, actorType: 'staff', action: 'x.y', entity: 'x', after: { passwordHash: 'SECRETX', nested: { token: 'SECRETY' } } },
      { db, now: 1 },
    );
    const row = audit.list({}, { db })[0]!;
    const text = JSON.stringify(row);
    expect(text).not.toContain('SECRETX');
    expect(text).not.toContain('SECRETY');
  });
});

describe('TRUST_PROXY в production задаётся явно', () => {
  it('предупреждение в production без TRUST_PROXY, без секретов', () => {
    const w = trustProxyWarning({ NODE_ENV: 'production', SESSION_SECRET: 'sekret-value-xxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    expect(w).toMatch(/TRUST_PROXY/);
    expect(w).not.toContain('sekret-value');
  });
  it('без предупреждения, если задан явно (true/false) или не production', () => {
    expect(trustProxyWarning({ NODE_ENV: 'production', TRUST_PROXY: 'true' })).toBeNull();
    expect(trustProxyWarning({ APP_ENV: 'production', TRUST_PROXY: 'false' })).toBeNull();
    expect(trustProxyWarning({ NODE_ENV: 'development' })).toBeNull();
    expect(trustProxyWarning({ NODE_ENV: 'production', TRUST_PROXY: '  ' })).toMatch(/TRUST_PROXY/);
  });
  it('connectApp пишет предупреждение при старте', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rts-f1-'));
    vi.stubEnv('DATABASE_PATH', join(tmp, 'rts.sqlite'));
    vi.stubEnv('DATA_DIR', tmp);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUST_PROXY', '');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    connectApp(); // на сборке ничего не подключается и не пишется
    expect(warn).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PHASE', '');
    try {
      connectApp({ startMailWorker: false });
    } catch {
      /* подключения могут требовать окружения — важно только предупреждение */
    }
    expect(warn.mock.calls.some((c) => String(c[0]).includes('TRUST_PROXY'))).toBe(true);
    warn.mockRestore();
    stopMailWorker();
    setPopularitySource(null);
    setMailEnqueue(null);
    setPaymentRunLogger(null);
    vi.unstubAllEnvs();
  });
});
