import { z } from 'zod';
import { selectMailPort } from '@/integrations/mail/ports';
import { audit } from '@/domain/admin/audit';
import { hasPermission, requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { settingsRepo } from '@/server/db/repositories/settings';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError, type FieldErrors } from '@/server/http/errors';
import { COUNTRIES, CURRENCIES, DEFAULT_CURRENCY, DEFAULT_TIMEZONE, getShopInfo, isValidTimeZone, MAX_SOCIAL_LINKS, parseSocialEntries, SOCIAL_TYPES, type SocialEntry } from './settings';
import { DEFAULT_FLAGS, FLAG_KEYS, invalidateStoreFlags, readStoreFlags, type StoreFlags } from './store-flags';
import { intakeFavicon, intakeLogo } from './store-media';

/**
 * Страница «Настройки магазина» (основные настройки и переключатели). Всё хранится в shop_settings:
 * текстовые ключи (store_name, tagline…), social_links (JSON), flag_* (переключатели), logo_path / favicon_path.
 * Сохранение — одной транзакцией, с проверкой версии (store_version): если кто-то успел сохранить раньше,
 * вторая запись получает понятную ошибку, а не молча перезаписывает чужие изменения.
 */
type Opts = { db?: Db; now?: number; uploadsDir?: string; mailConfigured?: boolean };

export const VERSION_KEY = 'store_version';
export const DEFAULT_STORE_NAME = 'РемТехСад';

export type MediaChange = { bytes: Uint8Array } | { remove: true } | undefined;

export type StoreSettingsInput = {
  /** Версия, с которой открыта форма. */
  version: number;
  storeName: string;
  tagline: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  workSchedule: string;
  socials: SocialEntry[];
  country: string;
  region: string;
  currency: string;
  timezone: string;
  flags: StoreFlags;
  maintenanceMessage: string;
  logo?: MediaChange;
  favicon?: MediaChange;
};

export type StoreSettingsView = {
  version: number;
  storeName: string;
  tagline: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  workSchedule: string;
  socials: SocialEntry[];
  country: string;
  region: string;
  currency: string;
  timezone: string;
  flags: StoreFlags;
  maintenanceMessage: string;
  /** Адрес настроенного логотипа / favicon; null — используется файл по умолчанию. */
  logoUrl: string | null;
  faviconUrl: string | null;
  /** Настроена ли отправка почты (без этого «Требовать подтверждение email» включить нельзя). */
  mailConfigured: boolean;
  /** Только просмотр: у сотрудника нет права «Изменение настроек магазина». */
  readOnly: boolean;
};

export const MAIL_REQUIRED_MESSAGE = 'Почта не настроена (MAIL_HOST и MAIL_FROM): подтверждение email включить нельзя — письма со ссылкой не уйдут';

const canView = (s: StaffSession): boolean => hasPermission(s, 'settings.write') || hasPermission(s, 'catalog.read');

const num = (v: string | undefined): number => (v && /^\d{1,9}$/.test(v) ? Number(v) : 0);

function mailConfiguredDefault(): boolean {
  try {
    return selectMailPort().status().connected;
  } catch {
    return false;
  }
}

export function getStoreSettings(session: StaffSession | null, opts: Opts = {}): StoreSettingsView {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!canView(session)) throw new ForbiddenError('Недостаточно прав для просмотра настроек магазина');
  const db = opts.db ?? getDb();
  const s = settingsRepo.all(db);
  const info = getShopInfo({ db });
  return {
    version: num(s[VERSION_KEY]),
    storeName: s.store_name ?? DEFAULT_STORE_NAME,
    tagline: s.tagline ?? info.tagline,
    description: s.store_description ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    address: s.address ?? '',
    workSchedule: s.work_schedule ?? '',
    socials: s.social_links !== undefined ? parseSocialEntries(s.social_links) : info.socials.flatMap((x) => (/^https?:/i.test(x.href) && SOCIAL_TYPES.some((t) => t.key === x.key) ? [{ type: x.key, url: x.href }] : [])),
    country: s.country ?? 'RU',
    region: s.region ?? '',
    currency: info.currency,
    timezone: info.timeZone,
    flags: readStoreFlags(db),
    maintenanceMessage: s.maintenance_message ?? '',
    logoUrl: s.logo_path ? info.logoUrl : null,
    faviconUrl: info.faviconUrl,
    mailConfigured: opts.mailConfigured ?? mailConfiguredDefault(),
    readOnly: !hasPermission(session, 'settings.write'),
  };
}

const text = (max: number, label: string) => z.string().trim().max(max, `${label}: не длиннее ${max} символов`);
const socialSchema = z.object({
  type: z.string().refine((t) => SOCIAL_TYPES.some((x) => x.key === t), 'Неизвестная соцсеть'),
  url: z.string().trim().max(300, 'Ссылка не длиннее 300 символов').regex(/^https?:\/\/[^\s]+$/i, 'Ссылка должна начинаться с http:// или https://'),
});
const schema = z.object({
  storeName: text(120, 'Название').min(1, 'Укажите название магазина'),
  tagline: text(200, 'Слоган'),
  description: text(1000, 'Описание'),
  phone: text(40, 'Телефон').refine((v) => v === '' || /\d{5,}/.test(v.replace(/\D/g, '')), 'В телефоне должно быть не меньше пяти цифр'),
  email: text(200, 'Email').refine((v) => v === '' || z.email().safeParse(v).success, 'Неверный адрес электронной почты'),
  address: text(300, 'Адрес'),
  workSchedule: text(200, 'График работы'),
  socials: z.array(socialSchema).max(MAX_SOCIAL_LINKS, `Не больше ${MAX_SOCIAL_LINKS} ссылок`),
  country: z.string().refine((c) => COUNTRIES.some((x) => x.value === c), 'Выберите страну из списка'),
  region: text(100, 'Регион'),
  currency: z.string().refine((c) => c in CURRENCIES, 'Выберите валюту из списка'),
  timezone: z.string().refine(isValidTimeZone, 'Неизвестный часовой пояс'),
  maintenanceMessage: text(500, 'Сообщение'),
});

function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const i of error.issues) (out[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  return out;
}

/** Ключ → новое значение ('' удаляет). Только то, что формой управляется. */
function planValues(v: z.infer<typeof schema>): Record<string, string> {
  return {
    store_name: v.storeName === DEFAULT_STORE_NAME ? '' : v.storeName,
    tagline: v.tagline,
    store_description: v.description,
    phone: v.phone,
    email: v.email,
    address: v.address,
    work_schedule: v.workSchedule,
    social_links: JSON.stringify(v.socials.map((s) => ({ type: s.type, url: s.url }))),
    country: v.country === 'RU' ? '' : v.country,
    region: v.region,
    currency: v.currency === DEFAULT_CURRENCY ? '' : v.currency,
    timezone: v.timezone === DEFAULT_TIMEZONE ? '' : v.timezone,
    maintenance_message: v.maintenanceMessage,
  };
}

export async function saveStoreSettings(session: StaffSession | null, input: StoreSettingsInput, opts: Opts = {}): Promise<{ changed: string[]; version: number }> {
  requirePermission(session, 'settings.write');
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fields = fieldErrors(parsed.error);
    throw new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
  }
  const before = settingsRepo.all(db);
  const beforeFlags = readStoreFlags(db);
  if (input.flags.emailConfirm && !beforeFlags.emailConfirm && !(opts.mailConfigured ?? mailConfiguredDefault())) {
    throw new ValidationError(MAIL_REQUIRED_MESSAGE, { emailConfirm: [MAIL_REQUIRED_MESSAGE] });
  }
  if (num(before[VERSION_KEY]) !== input.version) {
    throw new ConflictError('Настройки уже изменены другим сотрудником или в другой вкладке. Обновите страницу и повторите правки');
  }

  const values = planValues(parsed.data);
  const logoPath = input.logo && 'bytes' in input.logo ? await intakeLogo(input.logo.bytes, opts.uploadsDir) : undefined;
  const faviconPath = input.favicon && 'bytes' in input.favicon ? await intakeFavicon(input.favicon.bytes, opts.uploadsDir) : undefined;

  const changed: string[] = [];
  const version = input.version + 1;
  withTransaction(db, () => {
    // Версию перечитываем внутри транзакции: между проверкой выше и записью мог вклиниться другой запрос.
    if (num(settingsRepo.get(db, VERSION_KEY) ?? undefined) !== input.version) {
      throw new ConflictError('Настройки уже изменены другим сотрудником или в другой вкладке. Обновите страницу и повторите правки');
    }
    const put = (key: string, value: string): void => {
      if ((before[key] ?? '') === value) return;
      if (value === '') settingsRepo.delete(db, key);
      else settingsRepo.set(db, key, value, now);
      changed.push(key);
    };
    for (const [k, v] of Object.entries(values)) put(k, v);
    for (const k of Object.keys(FLAG_KEYS) as (keyof StoreFlags)[]) {
      const next = input.flags[k] === true;
      if (next !== beforeFlags[k]) {
        if (next === DEFAULT_FLAGS[k]) settingsRepo.delete(db, FLAG_KEYS[k]);
        else settingsRepo.set(db, FLAG_KEYS[k], next ? '1' : '0', now);
        changed.push(FLAG_KEYS[k]);
      }
    }
    if (logoPath) {
      settingsRepo.set(db, 'logo_path', logoPath, now);
      changed.push('logo_path');
    } else if (input.logo && 'remove' in input.logo && before.logo_path) {
      settingsRepo.delete(db, 'logo_path');
      changed.push('logo_path');
    }
    if (faviconPath) {
      settingsRepo.set(db, 'favicon_path', faviconPath, now);
      changed.push('favicon_path');
    } else if (input.favicon && 'remove' in input.favicon && before.favicon_path) {
      settingsRepo.delete(db, 'favicon_path');
      changed.push('favicon_path');
    }
    if (changed.length === 0) return;
    settingsRepo.set(db, VERSION_KEY, String(version), now);
    const after = settingsRepo.all(db);
    audit.record(
      {
        actorId: session.staffId,
        actorType: 'staff',
        action: 'settings.update',
        entity: 'store_settings',
        before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
        after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
      },
      { db, now },
    );
  });
  invalidateStoreFlags(db);
  return { changed, version: changed.length > 0 ? version : input.version };
}
