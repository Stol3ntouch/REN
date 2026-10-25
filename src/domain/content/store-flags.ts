import { getDb, type Db } from '@/server/db/connection';
import { settingsRepo } from '@/server/db/repositories/settings';
import { AppError } from '@/server/http/errors';

/**
 * Переключатели магазина (страница «Настройки магазина»). Хранятся в shop_settings ключами flag_*;
 * ключа нет — действует значение по умолчанию, которое повторяет поведение сайта до появления настроек.
 * Все проверки выполняются на сервере (proxy, обработчики, домен); скрытие в интерфейсе — только удобство.
 */
export type StoreFlags = {
  /** Выключен → витрина отвечает 503 «Магазин временно закрыт». */
  storeEnabled: boolean;
  /** Включён → витрина отвечает 503 всем, кроме сотрудников с активной сессией. */
  maintenance: boolean;
  /** Выключен → цены и «В корзину» скрыты, корзина и оформление отказывают. */
  showPrices: boolean;
  /** Выключен → регистрация отклоняется. */
  registration: boolean;
  /** Включён → регистрация создаёт неподтверждённый аккаунт, вход — только после подтверждения. */
  emailConfirm: boolean;
  /** Включён → honeypot и дополнительные лимиты форм. Обязательные меры (лимиты входа, Origin) от него не зависят. */
  spamProtection: boolean;
};

export const FLAG_KEYS: Record<keyof StoreFlags, string> = {
  storeEnabled: 'flag_store_enabled',
  maintenance: 'flag_maintenance',
  showPrices: 'flag_show_prices',
  registration: 'flag_registration',
  emailConfirm: 'flag_email_confirm',
  spamProtection: 'flag_spam_protection',
};

export const DEFAULT_FLAGS: Readonly<StoreFlags> = {
  storeEnabled: true,
  maintenance: false,
  showPrices: true,
  registration: true,
  emailConfirm: false,
  spamProtection: true,
};

/** Короткий кэш: прокси читает флаги на каждый запрос. Сохранение настроек сбрасывает кэш сразу. */
export const FLAGS_TTL_MS = 3000;

type Entry = { at: number; flags: StoreFlags };
// На globalThis: proxy, обработчики и страницы собираются в разные бандлы Next, а сброс кэша должен быть виден всем.
const g = globalThis as unknown as { __rtsStoreFlagsCache?: { byDb: WeakMap<Db, Entry> } };
const holder = (g.__rtsStoreFlagsCache ??= { byDb: new WeakMap() });

export function invalidateStoreFlags(db?: Db): void {
  if (db) holder.byDb.delete(db);
  else holder.byDb = new WeakMap();
}

const parseFlag = (raw: string | undefined, fallback: boolean): boolean => (raw === '1' ? true : raw === '0' ? false : fallback);

export function readStoreFlags(db: Db): StoreFlags {
  const all = settingsRepo.all(db);
  const out = { ...DEFAULT_FLAGS };
  for (const k of Object.keys(FLAG_KEYS) as (keyof StoreFlags)[]) out[k] = parseFlag(all[FLAG_KEYS[k]], DEFAULT_FLAGS[k]);
  return out;
}

export function getStoreFlags(opts: { db?: Db; now?: number } = {}): StoreFlags {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const hit = holder.byDb.get(db);
  if (hit && now - hit.at < FLAGS_TTL_MS && now >= hit.at) return hit.flags;
  const flags = readStoreFlags(db);
  holder.byDb.set(db, { at: now, flags });
  return flags;
}

type Opts = { db?: Db; now?: number };

/** 403: цены скрыты, корзина и оформление закрыты. */
export class PricesHiddenError extends AppError {
  constructor() {
    super('Оформление заказа сейчас недоступно', 403, 'prices_hidden');
  }
}
export class RegistrationClosedError extends AppError {
  constructor() {
    super('Регистрация сейчас закрыта', 403, 'registration_closed');
  }
}
export class StoreClosedError extends AppError {
  constructor() {
    super('Магазин временно закрыт', 503, 'store_closed');
  }
}

/** Корзина и оформление работают только при включённом «Показывать цены». */
export function assertPricesShown(opts: Opts = {}): void {
  if (!getStoreFlags(opts).showPrices) throw new PricesHiddenError();
}
export function assertRegistrationOpen(opts: Opts = {}): void {
  if (!getStoreFlags(opts).registration) throw new RegistrationClosedError();
}
/** Honeypot и дополнительные лимиты форм — только при включённой защите от спама. */
export function isSpamProtectionOn(opts: Opts = {}): boolean {
  try {
    return getStoreFlags(opts).spamProtection;
  } catch {
    return true; // нет БД/таблицы — защита остаётся включённой
  }
}
