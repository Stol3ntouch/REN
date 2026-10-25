import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { hasPermission, requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { MEDIA_BASE } from '@/domain/catalog/images';
import { formatRub } from '@/domain/pricing/format';
import { resolveSiteUrl } from '@/domain/seo/site-url';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { seoSettingsRepo, type SeoSampleProduct } from '@/server/db/repositories/seo-settings';
import { settingsRepo } from '@/server/db/repositories/settings';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError, type FieldErrors } from '@/server/http/errors';
import { getShopInfo, SITE_NAME } from './settings';
import { CHANGE_FREQUENCIES, SEO_SECTIONS, TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_HINT, type ChangeFrequency, type SeoSection, type TemplateVariable } from './seo-constants';
import { intakeOgImage } from './store-media';

export { CHANGE_FREQUENCIES, SEO_SECTIONS, SEO_SECTION_LABELS, TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_HINT, type ChangeFrequency, type SeoSection, type TemplateVariable } from './seo-constants';

/**
 * SEO и метаданные (страница /admin/settings/seo, право seo.write). Хранится в shop_settings ключами seo_*.
 * Приоритет текстов: индивидуальные SEO-поля товара/категории → шаблон из настроек → название и описание по умолчанию.
 * Значения по умолчанию повторяют поведение сайта до появления настроек.
 */
type Opts = { db?: Db; now?: number; uploadsDir?: string };

export type SeoTemplates = { productTitle: string; productDescription: string; categoryTitle: string; categoryDescription: string };
export type CanonicalHost = 'any' | 'www' | 'bare';

export type SeoSettings = {
  /** Название сайта для title/Open Graph; пусто — название магазина. */
  siteName: string;
  /** Meta Description по умолчанию; пусто — текст по умолчанию. */
  description: string;
  ogImagePath: string | null;
  ogType: 'website' | 'article';
  /** canonical и sitemap всегда по https (кроме localhost). */
  canonicalHttps: boolean;
  canonicalHost: CanonicalHost;
  /** false — сайт закрыт от индексации целиком (robots.txt и meta robots). */
  robotsIndex: boolean;
  robotsDisallow: string[];
  sitemapSections: Record<SeoSection, boolean>;
  changeFrequency: ChangeFrequency | null;
  priority: number | null;
  templates: SeoTemplates;
  noindexFilters: boolean;
  noindexEmptyCategories: boolean;
  version: number;
};

const K = {
  siteName: 'seo_site_name',
  description: 'seo_description',
  ogImagePath: 'seo_og_image_path',
  ogType: 'seo_og_type',
  canonicalHttps: 'seo_canonical_https',
  canonicalHost: 'seo_canonical_host',
  robotsIndex: 'seo_robots_index',
  robotsDisallow: 'seo_robots_disallow',
  sitemapOff: 'seo_sitemap_off',
  changeFrequency: 'seo_sitemap_changefreq',
  priority: 'seo_sitemap_priority',
  productTitle: 'seo_tpl_product_title',
  productDescription: 'seo_tpl_product_description',
  categoryTitle: 'seo_tpl_category_title',
  categoryDescription: 'seo_tpl_category_description',
  noindexFilters: 'seo_noindex_filters',
  noindexEmpty: 'seo_noindex_empty',
  version: 'seo_version',
} as const;

export const DEFAULT_SEO: Readonly<SeoSettings> = {
  siteName: '',
  description: '',
  ogImagePath: null,
  ogType: 'website',
  canonicalHttps: true,
  canonicalHost: 'any',
  robotsIndex: true,
  robotsDisallow: [],
  sitemapSections: { products: true, categories: true, pages: true, news: true, services: true },
  changeFrequency: null,
  priority: null,
  templates: { productTitle: '', productDescription: '', categoryTitle: '', categoryDescription: '' },
  noindexFilters: true,
  noindexEmptyCategories: false,
  version: 0,
};

const MAX_DISALLOW = 30;

export function parseSeoSettings(s: Record<string, string>): SeoSettings {
  const off = new Set((s[K.sitemapOff] ?? '').split(',').map((x) => x.trim()));
  const freq = s[K.changeFrequency];
  const prio = Number(s[K.priority]);
  const host = s[K.canonicalHost];
  return {
    siteName: s[K.siteName] ?? '',
    description: s[K.description] ?? '',
    ogImagePath: s[K.ogImagePath] || null,
    ogType: s[K.ogType] === 'article' ? 'article' : 'website',
    canonicalHttps: s[K.canonicalHttps] !== '0',
    canonicalHost: host === 'www' || host === 'bare' ? host : 'any',
    robotsIndex: s[K.robotsIndex] !== '0',
    robotsDisallow: (s[K.robotsDisallow] ?? '').split('\n').map((x) => x.trim()).filter(Boolean),
    sitemapSections: Object.fromEntries(SEO_SECTIONS.map((x) => [x, !off.has(x)])) as Record<SeoSection, boolean>,
    changeFrequency: (CHANGE_FREQUENCIES as readonly string[]).includes(freq ?? '') ? (freq as ChangeFrequency) : null,
    priority: s[K.priority] !== undefined && Number.isFinite(prio) && prio >= 0 && prio <= 1 ? prio : null,
    templates: {
      productTitle: s[K.productTitle] ?? '',
      productDescription: s[K.productDescription] ?? '',
      categoryTitle: s[K.categoryTitle] ?? '',
      categoryDescription: s[K.categoryDescription] ?? '',
    },
    noindexFilters: s[K.noindexFilters] !== '0',
    noindexEmptyCategories: s[K.noindexEmpty] === '1',
    version: /^\d{1,9}$/.test(s[K.version] ?? '') ? Number(s[K.version]) : 0,
  };
}

/** Настройки SEO. БД недоступна — значения по умолчанию (публичные страницы не должны падать из-за настроек). */
export function getSeoSettings(opts: { db?: Db } = {}): SeoSettings {
  try {
    return parseSeoSettings(settingsRepo.all(opts.db ?? getDb()));
  } catch {
    return DEFAULT_SEO;
  }
}

/** Название сайта для title и Open Graph: SEO-настройка → название магазина → «РемТехСад». */
export function effectiveSiteName(seo: SeoSettings, opts: { db?: Db } = {}): string {
  if (seo.siteName.trim()) return seo.siteName.trim();
  try {
    return getShopInfo(opts).siteName;
  } catch {
    return SITE_NAME;
  }
}

export function ogImageUrl(seo: SeoSettings): string | null {
  return seo.ogImagePath ? `${MEDIA_BASE}/${seo.ogImagePath}` : null;
}

// ---------- canonical ----------

/** Адрес сайта с правилами canonical: https и www/без www. Локальные адреса (localhost, IP) не меняются. */
export function applyCanonicalRules(siteUrl: string, seo: Pick<SeoSettings, 'canonicalHttps' | 'canonicalHost'>): string {
  let u: URL;
  try {
    u = new URL(siteUrl);
  } catch {
    return siteUrl;
  }
  const local = u.hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.endsWith('.localhost') || u.hostname.endsWith('.test');
  if (local) return u.origin;
  if (seo.canonicalHttps) u.protocol = 'https:';
  if (seo.canonicalHost === 'www' && !u.hostname.startsWith('www.')) u.hostname = `www.${u.hostname}`;
  if (seo.canonicalHost === 'bare' && u.hostname.startsWith('www.')) u.hostname = u.hostname.slice(4);
  return u.origin;
}

/** Публичный адрес сайта для canonical, sitemap и robots: SITE_URL + правила из настроек. */
export function publicSiteUrl(opts: { db?: Db; env?: Record<string, string | undefined> } = {}): string {
  return applyCanonicalRules(resolveSiteUrl(opts.env), getSeoSettings(opts));
}

// ---------- шаблоны ----------

export type TemplateVars = Record<TemplateVariable, string>;

/** Ошибка шаблона или null. Допустимы только переменные из TEMPLATE_VARIABLES, скобки парные. */
export function validateSeoTemplate(template: string, maxLength: number): string | null {
  if (template.length > maxLength) return `Шаблон длиннее ${maxLength} символов`;
  const rest = template.replace(/\{([^{}]*)\}/g, (_m, name: string) => (/^[a-z]+$/.test(name) && (TEMPLATE_VARIABLES as readonly string[]).includes(name) ? '' : '\u0000'));
  if (rest.includes('\u0000')) {
    const bad = [...template.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? '').find((n) => !(TEMPLATE_VARIABLES as readonly string[]).includes(n));
    return `Неизвестная переменная {${bad ?? ''}}. Доступны: ${TEMPLATE_VARIABLE_HINT}`;
  }
  if (/[{}]/.test(rest)) return 'Скобки { } должны быть парными и содержать имя переменной';
  return null;
}

/** Подставляет переменные и убирает следы пустых значений (двойные пробелы, висящие разделители, пустые скобки). */
export function renderSeoTemplate(template: string, vars: TemplateVars): string {
  const filled = template.replace(/\{([a-z]+)\}/g, (m, name: string) => ((TEMPLATE_VARIABLES as readonly string[]).includes(name) ? (vars[name as TemplateVariable] ?? '').trim() : m));
  return filled
    .replace(/\(\s*\)|\[\s*\]|«\s*»/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(\s[—–|-]\s)(?:\s*[—–|-]\s)+/g, '$1')
    .replace(/^[\s,;:|—–-]+|[\s,;:|—–-]+$/g, '')
    .trim();
}

/** Переменные товара; price — по настройкам валюты. */
export function productTemplateVars(p: { name: string; brand: string | null; category: string; unitKopecks: number }, site: string): TemplateVars {
  return { name: p.name, brand: p.brand ?? '', category: p.category, price: p.unitKopecks > 0 ? formatRub(p.unitKopecks) : '', site };
}
export function categoryTemplateVars(c: { name: string }, site: string): TemplateVars {
  return { name: c.name, brand: '', category: c.name, price: '', site };
}

// ---------- сохранение ----------

export type SeoSettingsInput = {
  version: number;
  siteName: string;
  description: string;
  ogType: string;
  canonicalHttps: boolean;
  canonicalHost: string;
  robotsIndex: boolean;
  /** Строки Disallow: по одной на строку. */
  robotsDisallow: string;
  sitemapSections: Record<SeoSection, boolean>;
  changeFrequency: string;
  priority: string;
  templates: SeoTemplates;
  noindexFilters: boolean;
  noindexEmptyCategories: boolean;
  ogImage?: { bytes: Uint8Array } | { remove: true };
};

const trimmed = (max: number, label: string) => z.string().trim().max(max, `${label}: не длиннее ${max} символов`);
const schema = z.object({
  siteName: trimmed(120, 'Название сайта'),
  description: trimmed(300, 'Meta Description'),
  ogType: z.enum(['website', 'article'], { error: 'Тип Open Graph: website или article' }),
  canonicalHost: z.enum(['any', 'www', 'bare'], { error: 'Выберите правило для www' }),
  changeFrequency: z.string().refine((v) => v === '' || (CHANGE_FREQUENCIES as readonly string[]).includes(v), 'Неизвестная частота обновления'),
  priority: z.string().trim().refine((v) => v === '' || (/^(0(\.\d)?|1(\.0)?)$/.test(v.replace(',', '.'))), 'Приоритет — число от 0 до 1 (например 0.5)'),
});

export function parseDisallowLines(raw: string): { paths: string[]; error?: string } {
  const paths: string[] = [];
  for (const line of raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (!line.startsWith('/')) return { paths, error: `Путь «${line}» должен начинаться с «/»` };
    if (line === '/') return { paths, error: 'Закрыть весь сайт можно переключателем «Индексировать сайт», а не путём «/»' };
    if (/\s/.test(line) || line.length > 120) return { paths, error: `Некорректный путь «${line.slice(0, 40)}»` };
    if (!paths.includes(line)) paths.push(line);
  }
  if (paths.length > MAX_DISALLOW) return { paths, error: `Не больше ${MAX_DISALLOW} путей` };
  return { paths };
}

const TEMPLATE_LIMITS: Record<keyof SeoTemplates, number> = { productTitle: 200, productDescription: 400, categoryTitle: 200, categoryDescription: 400 };

const canView = (s: StaffSession): boolean => hasPermission(s, 'seo.write') || hasPermission(s, 'catalog.read');

export type SeoSettingsView = SeoSettings & { ogImageUrl: string | null; readOnly: boolean };

export function getSeoSettingsView(session: StaffSession | null, opts: Opts = {}): SeoSettingsView {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!canView(session)) throw new ForbiddenError('Недостаточно прав для просмотра SEO-настроек');
  const seo = getSeoSettings(opts);
  return { ...seo, ogImageUrl: ogImageUrl(seo), readOnly: !hasPermission(session, 'seo.write') };
}

const CONFLICT = 'SEO-настройки уже изменены другим сотрудником или в другой вкладке. Обновите страницу и повторите правки';

export async function saveSeoSettings(session: StaffSession | null, input: SeoSettingsInput, opts: Opts = {}): Promise<{ changed: string[]; version: number }> {
  requirePermission(session, 'seo.write');
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();

  const parsed = schema.safeParse(input);
  const fields: FieldErrors = {};
  if (!parsed.success) for (const i of parsed.error.issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  const disallow = parseDisallowLines(input.robotsDisallow);
  if (disallow.error) fields.robotsDisallow = [disallow.error];
  for (const key of Object.keys(TEMPLATE_LIMITS) as (keyof SeoTemplates)[]) {
    const err = validateSeoTemplate(input.templates[key].trim(), TEMPLATE_LIMITS[key]);
    if (err) fields[`tpl_${key}`] = [err];
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
  const data = parsed.data as z.infer<typeof schema>;

  const before = settingsRepo.all(db);
  if (parseSeoSettings(before).version !== input.version) throw new ConflictError(CONFLICT);

  const ogPath = input.ogImage && 'bytes' in input.ogImage ? await intakeOgImage(input.ogImage.bytes, opts.uploadsDir) : undefined;
  const prio = data.priority === '' ? '' : String(Number(data.priority.replace(',', '.')));
  const next: Record<string, string> = {
    [K.siteName]: data.siteName,
    [K.description]: data.description,
    [K.ogType]: data.ogType === 'website' ? '' : data.ogType,
    [K.canonicalHttps]: input.canonicalHttps ? '' : '0',
    [K.canonicalHost]: data.canonicalHost === 'any' ? '' : data.canonicalHost,
    [K.robotsIndex]: input.robotsIndex ? '' : '0',
    [K.robotsDisallow]: disallow.paths.join('\n'),
    [K.sitemapOff]: SEO_SECTIONS.filter((x) => !input.sitemapSections[x]).join(','),
    [K.changeFrequency]: data.changeFrequency,
    [K.priority]: prio,
    [K.productTitle]: input.templates.productTitle.trim(),
    [K.productDescription]: input.templates.productDescription.trim(),
    [K.categoryTitle]: input.templates.categoryTitle.trim(),
    [K.categoryDescription]: input.templates.categoryDescription.trim(),
    [K.noindexFilters]: input.noindexFilters ? '' : '0',
    [K.noindexEmpty]: input.noindexEmptyCategories ? '1' : '',
  };

  const changed: string[] = [];
  const version = input.version + 1;
  withTransaction(db, () => {
    if (parseSeoSettings(settingsRepo.all(db)).version !== input.version) throw new ConflictError(CONFLICT);
    for (const [key, value] of Object.entries(next)) {
      if ((before[key] ?? '') === value) continue;
      if (value === '') settingsRepo.delete(db, key);
      else settingsRepo.set(db, key, value, now);
      changed.push(key);
    }
    if (ogPath) {
      settingsRepo.set(db, K.ogImagePath, ogPath, now);
      changed.push(K.ogImagePath);
    } else if (input.ogImage && 'remove' in input.ogImage && before[K.ogImagePath]) {
      settingsRepo.delete(db, K.ogImagePath);
      changed.push(K.ogImagePath);
    }
    if (changed.length === 0) return;
    settingsRepo.set(db, K.version, String(version), now);
    const after = settingsRepo.all(db);
    audit.record(
      {
        actorId: session.staffId,
        actorType: 'staff',
        action: 'settings.update',
        entity: 'seo_settings',
        before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
        after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
      },
      { db, now },
    );
  });
  return { changed, version: changed.length > 0 ? version : input.version };
}

// ---------- предпросмотр ----------

export type TemplatePreview = { ok: true; text: string; sample: string } | { ok: false; error: string } | { ok: false; empty: true; error: string };

/** Предпросмотр шаблона на реальном товаре (kind product) или реальной категории (kind category). */
export function previewSeoTemplate(
  session: StaffSession | null,
  input: { kind: keyof SeoTemplates; template: string; productSlug?: string },
  opts: { db?: Db } = {},
): TemplatePreview {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!canView(session)) throw new ForbiddenError('Недостаточно прав');
  const db = opts.db ?? getDb();
  const err = validateSeoTemplate(input.template.trim(), TEMPLATE_LIMITS[input.kind]);
  if (err) return { ok: false, error: err };
  const seo = getSeoSettings({ db });
  const site = effectiveSiteName(seo, { db });
  if (input.kind.startsWith('product')) {
    const p: SeoSampleProduct | null = seoSettingsRepo.sampleProduct(db, input.productSlug);
    if (!p) return { ok: false, empty: true, error: 'В каталоге пока нет товаров для предпросмотра' };
    return { ok: true, sample: p.name, text: renderSeoTemplate(input.template, productTemplateVars(p, site)) };
  }
  const c = seoSettingsRepo.sampleCategory(db);
  if (!c) return { ok: false, empty: true, error: 'В каталоге пока нет категорий с товарами для предпросмотра' };
  return { ok: true, sample: c.name, text: renderSeoTemplate(input.template, categoryTemplateVars(c, site)) };
}
