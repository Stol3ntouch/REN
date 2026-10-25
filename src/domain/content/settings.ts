import { getDb, type Db } from '@/server/db/connection';
import { settingsRepo } from '@/server/db/repositories/settings';
import { MEDIA_BASE } from '@/domain/catalog/images';
import { setCurrencySymbolProvider } from '@/domain/pricing/format';
import { invalidateStoreFlags } from './store-flags';
import { CURRENCIES, DEFAULT_CURRENCY, DEFAULT_TAGLINE, DEFAULT_TIMEZONE, isValidTimeZone, MAX_SOCIAL_LINKS, SOCIAL_TYPES, type SocialEntry } from './store-constants';

export { COUNTRIES, CURRENCIES, DEFAULT_CURRENCY, DEFAULT_TAGLINE, DEFAULT_TIMEZONE, isValidTimeZone, MAX_SOCIAL_LINKS, SOCIAL_TYPES, TIME_ZONES, type SocialEntry } from './store-constants';

/**
 * Настройки магазина (таблица shop_settings, ключ-значение). Пустое значение = «не задано» (ключ удаляется),
 * и страницы показывают метку-заглушку. Другие задачи могут хранить здесь свои ключи (латиница, точки и «_»):
 * setSetting принимает любой допустимый ключ, форма админки «Настройки магазина» правит только EDITABLE_SETTING_KEYS.
 */
export const EDITABLE_SETTING_KEYS = [
  'phone',
  'address',
  'email',
  'latitude',
  'longitude',
  'social_vk',
  'social_telegram',
  'social_whatsapp',
  'social_youtube',
  'requisites',
  'delivery_payment_text',
  'home_h1',
  'home_title',
  'home_description',
] as const;
export type EditableSettingKey = (typeof EDITABLE_SETTING_KEYS)[number];
/**
 * Ключи страницы «Настройки магазина» (C11). Правятся страницей /admin/settings/store, а не формой контента:
 * logo_path и favicon_path ставятся загрузкой файла (путь в каталоге загрузок), social_links — JSON-список.
 */
export const STORE_SETTING_KEYS = [
  'store_name',
  'tagline',
  'store_description',
  'work_schedule',
  'social_links',
  'country',
  'region',
  'currency',
  'timezone',
  'maintenance_message',
] as const;
export type StoreSettingKey = (typeof STORE_SETTING_KEYS)[number];
/** logo_path ставится загрузкой логотипа (путь файла в каталоге загрузок), а не текстовым полем. */
export type SettingKey = EditableSettingKey | StoreSettingKey | 'logo_path' | 'favicon_path';

export const SITE_NAME = 'РемТехСад';
export const DEFAULT_LOGO_URL = '/brand/logo.png';
/** Вариант для тёмного подвала: чёрные буквы светлые, зелёные остаются. */
export const DEFAULT_LOGO_DARK_URL = '/brand/logo-dark.png';
const KEY_RE = /^[a-z][a-z0-9_.]{0,63}$/;
const MAX_VALUE = 5000;

type Opts = { db?: Db; now?: number };

export function getSetting(key: string, opts: Opts = {}): string | null {
  return settingsRepo.get(opts.db ?? getDb(), key);
}

export function getSettings(opts: Opts = {}): Record<string, string> {
  return settingsRepo.all(opts.db ?? getDb());
}

/** Записывает значение (обрезав пробелы); пустое — удаляет ключ. Неверный ключ или слишком длинное значение — исключение. */
export function setSetting(key: string, value: string, opts: Opts = {}): void {
  if (!KEY_RE.test(key)) throw new Error(`Недопустимый ключ настройки: ${key}`);
  const v = value.trim();
  if (v.length > MAX_VALUE) throw new Error(`Значение настройки ${key} длиннее ${MAX_VALUE} символов`);
  const db = opts.db ?? getDb();
  if (v === '') settingsRepo.delete(db, key);
  else settingsRepo.set(db, key, v, opts.now ?? Date.now());
  if (key.startsWith('flag_')) invalidateStoreFlags(db);
}

export type SocialLink = { key: string; label: string; href: string };


/** Разбор JSON-списка соцсетей из настройки: мусор и не-http(s) ссылки отбрасываются. */
export function parseSocialEntries(raw: string | undefined | null): SocialEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: SocialEntry[] = [];
    for (const it of data as Partial<SocialEntry>[]) {
      const type = typeof it?.type === 'string' ? it.type : '';
      const url = typeof it?.url === 'string' ? it.url.trim() : '';
      if (SOCIAL_TYPES.some((t) => t.key === type) && /^https?:\/\/\S+$/i.test(url)) out.push({ type, url });
    }
    return out.slice(0, MAX_SOCIAL_LINKS);
  } catch {
    return [];
  }
}

export type ShopInfo = {
  siteName: string;
  /** Слоган (по умолчанию из брифа). */
  tagline: string;
  /** Описание магазина; нет — null (метаданные берут запасное). */
  description: string | null;
  /** Адрес favicon; нет — null (используется файл по умолчанию). */
  faviconUrl: string | null;
  /** ISO-код валюты (по умолчанию RUB) и символ для показа. */
  currency: string;
  currencySymbol: string;
  /** IANA-зона для показа дат. */
  timeZone: string;
  phone: string | null;
  /** tel:+79166550606 */
  phoneHref: string | null;
  address: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  socials: SocialLink[];
  logoUrl: string;
  requisites: string | null;
  deliveryPaymentText: string | null;
};

export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  return /\d{5,}/.test(digits) ? `tel:${digits}` : null;
}

function parseCoord(v: string | undefined, limit: number): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

const SOCIALS: { key: string; setting: string; label: string }[] = [
  { key: 'vk', setting: 'social_vk', label: 'ВКонтакте' },
  { key: 'telegram', setting: 'social_telegram', label: 'Telegram' },
  { key: 'whatsapp', setting: 'social_whatsapp', label: 'WhatsApp' },
  { key: 'youtube', setting: 'social_youtube', label: 'YouTube' },
];

const nonEmpty = (v: string | undefined): string | null => (v && v.trim() !== '' ? v : null);

function currencyOf(s: Record<string, string>): string {
  const c = (s.currency ?? '').toUpperCase();
  return CURRENCIES[c] ? c : DEFAULT_CURRENCY;
}
function timeZoneOf(s: Record<string, string>): string {
  const tz = s.timezone ?? '';
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Страница настроек хранит список «тип + ссылка»; пока он не задан — четыре прежних ключа (форма контента). */
function socialsOf(s: Record<string, string>): SocialLink[] {
  if (s.social_links !== undefined) {
    return parseSocialEntries(s.social_links).map((e) => ({ key: e.type, label: SOCIAL_TYPES.find((t) => t.key === e.type)?.label ?? e.type, href: e.url }));
  }
  return SOCIALS.flatMap((x) => (nonEmpty(s[x.setting]) ? [{ key: x.key, label: x.label, href: s[x.setting] as string }] : []));
}

/** Часовой пояс магазина (для дат витрины и админки); без БД и настройки — Москва. */
export function getStoreTimeZone(opts: Opts = {}): string {
  try {
    return timeZoneOf(getSettings(opts));
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

// Символ валюты для formatRub: pricing/format не знает про БД, поставщик регистрируется при загрузке этого модуля.
setCurrencySymbolProvider(() => {
  try {
    return CURRENCIES[currencyOf(getSettings())]?.symbol ?? '₽';
  } catch {
    return '₽';
  }
});

/** Собранные настройки для шапки, подвала, контактов и карты. Заданные соцсети — только они. */
export function getShopInfo(opts: Opts = {}): ShopInfo {
  const s = getSettings(opts);
  const lat = parseCoord(s.latitude, 90);
  const lng = parseCoord(s.longitude, 180);
  const hasCoords = lat !== null && lng !== null;
  return {
    siteName: nonEmpty(s.store_name) ?? SITE_NAME,
    tagline: nonEmpty(s.tagline) ?? DEFAULT_TAGLINE,
    description: nonEmpty(s.store_description),
    faviconUrl: s.favicon_path ? `${MEDIA_BASE}/${s.favicon_path}` : null,
    currency: currencyOf(s),
    currencySymbol: CURRENCIES[currencyOf(s)]?.symbol ?? '₽',
    timeZone: timeZoneOf(s),
    phone: nonEmpty(s.phone),
    phoneHref: telHref(s.phone),
    address: nonEmpty(s.address),
    email: nonEmpty(s.email),
    latitude: hasCoords ? lat : null,
    longitude: hasCoords ? lng : null,
    socials: socialsOf(s),
    logoUrl: s.logo_path ? `${MEDIA_BASE}/${s.logo_path}` : DEFAULT_LOGO_URL,
    requisites: nonEmpty(s.requisites),
    deliveryPaymentText: nonEmpty(s.delivery_payment_text),
  };
}
