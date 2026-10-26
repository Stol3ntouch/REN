import { INTEGRATIONS, fingerprintOf, integrationDef, type IntegrationDef, type IntegrationKey, type ProbeDeps } from '@/integrations/registry';
import { getDb, type Db } from '@/server/db/connection';
import { integrationChecksRepo } from '@/server/db/repositories/integration-settings';
import { integrationRunsRepo } from '@/server/db/repositories/integration-runs';
import { NotFoundError } from '@/server/http/errors';
import { audit } from './audit';
import { notify } from './notifications';
import { requirePermission, type Permission, type StaffSession } from './permissions';

/**
 * Карточки интеграций со статусами (C12, ADR-016):
 *   не настроено | настроено, не проверено | подключено (проверено <время>) | ошибка (<причина без секретов>).
 * «Подключено» ставится только результатом реальной проверки порта и только пока настройки не менялись и проверка свежая (24 часа).
 * Значения секретов нигде не читаются для показа: в ответе только «задан / не задан».
 */

export type IntegrationState = 'not_configured' | 'configured_unverified' | 'connected' | 'error';

export const STATE_LABELS: Record<IntegrationState, string> = {
  not_configured: 'Не настроено',
  configured_unverified: 'Настроено, не проверено',
  connected: 'Подключено',
  error: 'Ошибка',
};

export const CHECK_TTL_MS = 24 * 3_600_000;

type Env = Record<string, string | undefined>;
type Opts = { db?: Db; now?: number; env?: Env; mailPort?: ProbeDeps['mailPort']; timeoutMs?: number };

export type IntegrationCard = {
  key: IntegrationKey;
  label: string;
  description: string;
  state: IntegrationState;
  /** Время последней проверки (для connected и error). */
  checkedAt: number | null;
  /** Причина ошибки или пояснение; без секретов. */
  message: string | null;
  implemented: boolean;
  env: { name: string; purpose: string; set: boolean }[];
};

/** Убирает из текста значения секретов окружения (на случай, если чужая библиотека вставила их в сообщение). */
export function scrubSecrets(text: string, def: IntegrationDef, env: Env): string {
  let t = text;
  for (const v of def.env) {
    const value = (env[v.name] ?? '').trim();
    if (v.secret && value.length >= 3) t = t.split(value).join('***');
  }
  // Хост и порт SMTP не секрет, но имя пользователя часто равно адресу почты: маскируем адреса.
  return t.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '***').replace(/\s+/g, ' ').slice(0, 300);
}

function cardFor(db: Db, def: IntegrationDef, env: Env, now: number): IntegrationCard {
  const base = {
    key: def.key,
    label: def.label,
    description: def.description,
    implemented: def.implemented,
    env: def.env.map((v) => ({ name: v.name, purpose: v.purpose, set: (env[v.name] ?? '').trim() !== '' })),
  };
  if (!def.configured(env)) return { ...base, state: 'not_configured', checkedAt: null, message: null };
  const check = integrationChecksRepo.get(db, def.key);
  if (!check) return { ...base, state: 'configured_unverified', checkedAt: null, message: null };
  if (check.fingerprint !== fingerprintOf(def.key, env)) return { ...base, state: 'configured_unverified', checkedAt: null, message: 'Настройки изменились после последней проверки' };
  if (check.status === 'error') return { ...base, state: 'error', checkedAt: check.checkedAt, message: check.message };
  if (now - check.checkedAt > CHECK_TTL_MS || now < check.checkedAt) return { ...base, state: 'configured_unverified', checkedAt: check.checkedAt, message: 'Проверка устарела — проверьте соединение заново' };
  return { ...base, state: 'connected', checkedAt: check.checkedAt, message: check.message };
}

export const integrationsAdmin = {
  /** Одна карточка; право можно задать (страница оплаты читает свою карточку по payments.write). */
  card(session: StaffSession | null, key: string, opts: Opts = {}, permission: Permission = 'integrations.read'): IntegrationCard {
    requirePermission(session, permission);
    const def = integrationDef(key);
    if (!def) throw new NotFoundError('Интеграция не найдена');
    return cardFor(opts.db ?? getDb(), def, opts.env ?? process.env, opts.now ?? Date.now());
  },

  cards(session: StaffSession | null, opts: Opts = {}): IntegrationCard[] {
    requirePermission(session, 'integrations.read');
    const db = opts.db ?? getDb();
    const env = opts.env ?? process.env;
    const now = opts.now ?? Date.now();
    return INTEGRATIONS.map((d) => cardFor(db, d, env, now));
  },

  /**
   * «Проверить соединение»: реальная проверка порта. Успех сохраняется как «подключено», неуспех — как «ошибка»
   * (и сообщает в уведомления админки). Не настроенный сервис не проверяется.
   */
  async check(session: StaffSession | null, key: string, opts: Opts = {}, permission: Permission = 'integrations.run'): Promise<IntegrationCard> {
    requirePermission(session, permission);
    const def = integrationDef(key);
    if (!def) throw new NotFoundError('Интеграция не найдена');
    const db = opts.db ?? getDb();
    const env = opts.env ?? process.env;
    const now = opts.now ?? Date.now();
    if (!def.configured(env)) return cardFor(db, def, env, now);

    const runId = integrationRunsRepo.start(db, { kind: `check.${def.key}`, actor: `staff:${session.staffId}`, now });
    let ok = false;
    let message: string;
    try {
      const r = await def.probe({ env, mailPort: opts.mailPort, timeoutMs: opts.timeoutMs });
      ok = r.ok;
      message = scrubSecrets(r.message, def, env);
    } catch (e) {
      message = scrubSecrets(e instanceof Error ? e.message : 'Проверка не удалась', def, env);
    }
    integrationChecksRepo.save(db, { key: def.key, status: ok ? 'ok' : 'error', message, fingerprint: fingerprintOf(def.key, env), now, staffId: session.staffId });
    integrationRunsRepo.finish(db, runId, { status: ok ? 'ok' : 'error', counts: { checked: 1 }, errors: ok ? [] : [message], now });
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'integration.check', entity: 'integration', entityId: def.key, result: ok ? 'ok' : 'error' }, { db, now });
    if (!ok) {
      try {
        notify({ type: 'integration.check_failed', title: `Проверка соединения не прошла: ${def.label}`, body: message, href: '/admin/integrations', entity: 'integration', entityId: def.key, severity: 'error', audience: 'permission:integrations.read' }, { db, now });
      } catch {
        /* уведомление не должно ломать проверку */
      }
    }
    return cardFor(db, def, env, now);
  },
};
