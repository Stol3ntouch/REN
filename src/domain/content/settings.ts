import { getDb, type Db } from '@/server/db/connection';
import { settingsRepo } from '@/server/db/repositories/settings';
import { MEDIA_BASE } from '@/domain/catalog/images';

/**
 * Настройки магазина (таблица shop_settings, ключ-значение). Пустое значение = «не задано» (ключ удаляется),
 * и страницы показывают метку-заглушку. Другие задачи могут хранить здесь свои ключи (латиница, точки и «_»):
 * setSetting принимает любой допустимый ключ, форма админки «Настройки магазина» правит только EDITABLE_SETTING_KEYS.
 */
export const EDITABLE_SETTING_KEYS = [
  'phone',
  'address',
  'work_hours',
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
/** logo_path ставится загрузкой логотипа (путь файла в каталоге загрузок), а не текстовым полем. */
export type SettingKey = EditableSettingKey | 'logo_path';

export const SITE_NAME = 'РемТехСад';
export const DEFAULT_LOGO_URL = '/brand/logo.jpg';
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
}

export type SocialLink = { key: string; label: string; href: string };

export type ShopInfo = {
  siteName: string;
  phone: string | null;
  /** tel:+79166550606 */
  phoneHref: string | null;
  address: string | null;
  hours: string | null;
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

/** Собранные настройки для шапки, подвала, контактов и карты. Заданные соцсети — только они. */
export function getShopInfo(opts: Opts = {}): ShopInfo {
  const s = getSettings(opts);
  const lat = parseCoord(s.latitude, 90);
  const lng = parseCoord(s.longitude, 180);
  const hasCoords = lat !== null && lng !== null;
  return {
    siteName: SITE_NAME,
    phone: nonEmpty(s.phone),
    phoneHref: telHref(s.phone),
    address: nonEmpty(s.address),
    hours: nonEmpty(s.work_hours),
    email: nonEmpty(s.email),
    latitude: hasCoords ? lat : null,
    longitude: hasCoords ? lng : null,
    socials: SOCIALS.flatMap((x) => (nonEmpty(s[x.setting]) ? [{ key: x.key, label: x.label, href: s[x.setting] as string }] : [])),
    logoUrl: s.logo_path ? `${MEDIA_BASE}/${s.logo_path}` : DEFAULT_LOGO_URL,
    requisites: nonEmpty(s.requisites),
    deliveryPaymentText: nonEmpty(s.delivery_payment_text),
  };
}
