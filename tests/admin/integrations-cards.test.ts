import { describe, expect, it } from 'vitest';
import { CHECK_TTL_MS, integrationsAdmin } from '@/domain/admin/integrations';
import { createStubMailPort } from '@/integrations/mail/ports';
import type { MailPort } from '@/integrations/mail/types';
import { INTEGRATIONS, fingerprintOf } from '@/integrations/registry';
import { integrationsOps } from '@/app/admin/(panel)/_lib/integrations-ops';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, NotFoundError } from '@/server/http/errors';
import { admin, manager, T0 } from './helpers';

const SMTP = { MAIL_HOST: 'smtp.private.example', MAIL_FROM: 'shop@private.example', MAIL_USER: 'user@private.example', MAIL_PASSWORD: 'p@ss-TOPSECRET' };
const livePort = (verify: () => Promise<void>): MailPort => ({ name: 'smtp', status: () => ({ connected: true, mode: 'live' }), send: async () => undefined, verify });
const card = (db: ReturnType<typeof createTestDb>, key: string, env: Record<string, string>, now = T0) => integrationsAdmin.cards(admin, { db, env, now }).find((c) => c.key === key)!;

describe('карточки интеграций: честные статусы', () => {
  it('в чистой среде всё «не настроено», включая CRM и аналитику', () => {
    const db = createTestDb();
    const cards = integrationsAdmin.cards(admin, { db, env: {}, now: T0 });
    expect(cards.map((c) => c.key)).toEqual(['payment', 'delivery', 'mail', 'onec', 'crm', 'analytics']);
    expect(cards.every((c) => c.state === 'not_configured')).toBe(true);
  });

  it('настроено, но не проверено — это не «подключено»', () => {
    const db = createTestDb();
    expect(card(db, 'mail', SMTP)).toMatchObject({ state: 'configured_unverified', checkedAt: null });
  });

  it('«подключено» появляется только после успешной проверки порта', async () => {
    const db = createTestDb();
    const c = await integrationsAdmin.check(admin, 'mail', { db, env: SMTP, now: T0, mailPort: livePort(async () => undefined) });
    expect(c).toMatchObject({ state: 'connected', checkedAt: T0 });
    expect(card(db, 'mail', SMTP, T0 + 1000).state).toBe('connected');
  });

  it('проверка с ошибкой даёт «ошибка» с причиной без секретов и уведомление админке', async () => {
    const db = createTestDb();
    const port = livePort(async () => {
      throw new Error('Invalid login: 535 for user@private.example password p@ss-TOPSECRET at smtp.private.example');
    });
    const c = await integrationsAdmin.check(admin, 'mail', { db, env: SMTP, now: T0, mailPort: port });
    expect(c.state).toBe('error');
    const dump = JSON.stringify(c);
    expect(dump).not.toContain('TOPSECRET');
    expect(dump).not.toContain('user@private.example');
    expect(db.prepare("SELECT type, severity FROM admin_notifications WHERE type = 'integration.check_failed'").all()).toEqual([{ type: 'integration.check_failed', severity: 'error' }]);
    expect(db.prepare("SELECT status FROM integration_run WHERE kind = 'check.mail'").get()).toEqual({ status: 'error' });
  });

  it('таймаут проверки — ошибка, а не зависание и не «подключено»', async () => {
    const db = createTestDb();
    const hang = livePort(() => new Promise<void>(() => undefined));
    const c = await integrationsAdmin.check(admin, 'mail', { db, env: SMTP, now: T0, mailPort: hang, timeoutMs: 20 });
    expect(c.state).toBe('error');
    expect(c.message).toContain('не ответил');
  });

  it('смена настроек сбрасывает «подключено»; устаревшая проверка тоже', async () => {
    const db = createTestDb();
    await integrationsAdmin.check(admin, 'mail', { db, env: SMTP, now: T0, mailPort: livePort(async () => undefined) });
    expect(card(db, 'mail', { ...SMTP, MAIL_HOST: 'other.example' }, T0 + 1)).toMatchObject({ state: 'configured_unverified' });
    expect(card(db, 'mail', { ...SMTP, MAIL_PASSWORD: 'другой-пароль-иной-длины-999' }, T0 + 1).state).toBe('configured_unverified');
    expect(card(db, 'mail', SMTP, T0 + CHECK_TTL_MS + 1).state).toBe('configured_unverified');
  });

  it('заглушки не становятся «подключено» никогда: платёж, доставка, 1С', async () => {
    const db = createTestDb();
    const env = { PAYMENT_PROVIDER: 'yookassa', PAYMENT_API_KEY: 'k_live_TOPSECRET', DELIVERY_MODE: 'live', ONEC_MODE: 'live' };
    for (const key of ['payment', 'delivery', 'onec'] as const) {
      const c = await integrationsAdmin.check(admin, key, { db, env, now: T0 });
      expect(c.state, key).toBe('error');
      expect(JSON.stringify(c)).not.toContain('TOPSECRET');
    }
  });

  it('CRM и аналитика — заготовки: проверка ничего не делает, статус «не настроено»', async () => {
    const db = createTestDb();
    expect((await integrationsAdmin.check(admin, 'crm', { db, env: {}, now: T0 })).state).toBe('not_configured');
    expect(db.prepare('SELECT COUNT(*) AS n FROM integration_checks').get()).toEqual({ n: 0 });
  });

  it('тестовый провайдер вне production не считается подключённым', async () => {
    const db = createTestDb();
    const c = await integrationsAdmin.check(admin, 'payment', { db, env: { PAYMENT_PROVIDER: 'test', PAYMENT_API_KEY: 'x' }, now: T0 });
    expect(c.state).not.toBe('connected');
  });

  it('заглушка почты без SMTP не проверяется как подключённая', async () => {
    const db = createTestDb();
    const c = await integrationsAdmin.check(admin, 'mail', { db, env: SMTP, now: T0, mailPort: createStubMailPort() });
    expect(c.state).toBe('error');
  });

  it('неизвестная интеграция → 404', async () => {
    await expect(integrationsAdmin.check(admin, 'nope', { db: createTestDb(), env: {} })).rejects.toThrow(NotFoundError);
  });
});

describe('секреты не попадают в ответы', () => {
  it('overview содержит карточки без значений переменных', () => {
    const db = createTestDb();
    const view = integrationsOps.overview(admin, { db, now: T0, env: { ...SMTP, PAYMENT_API_KEY: 'sk_live_TOPSECRET_123', PAYMENT_PROVIDER: 'yookassa' } });
    const dump = JSON.stringify(view);
    for (const secret of ['TOPSECRET', 'smtp.private.example', 'shop@private.example', 'user@private.example']) expect(dump).not.toContain(secret);
    expect(view.cards.find((c) => c.key === 'payment')!.env.find((e) => e.name === 'PAYMENT_API_KEY')).toEqual({ name: 'PAYMENT_API_KEY', purpose: expect.any(String), set: true });
  });

  it('отпечаток настроек не содержит значений секретов и зависит от них только через длину', () => {
    const fp = fingerprintOf('mail', SMTP);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintOf('mail', { ...SMTP, MAIL_PASSWORD: 'X'.repeat('p@ss-TOPSECRET'.length) })).toBe(fp);
    expect(fingerprintOf('mail', { ...SMTP, MAIL_HOST: 'other' })).not.toBe(fp);
  });

  it('все описания переменных секретов помечены secret, а имена — из .env.example', () => {
    const secrets = INTEGRATIONS.flatMap((i) => i.env.filter((e) => e.secret).map((e) => e.name)).sort();
    expect(secrets).toEqual(['MAIL_PASSWORD', 'MAIL_USER', 'PAYMENT_API_KEY', 'PAYMENT_WEBHOOK_SECRET']);
  });
});

describe('права integrations.read / integrations.run', () => {
  it('менеджер видит карточки, но проверять не может', async () => {
    const db = createTestDb();
    expect(() => integrationsAdmin.cards(manager, { db, env: {}, now: T0 })).not.toThrow();
    await expect(integrationsAdmin.check(manager, 'mail', { db, env: SMTP, now: T0 })).rejects.toThrow(ForbiddenError);
  });
});
