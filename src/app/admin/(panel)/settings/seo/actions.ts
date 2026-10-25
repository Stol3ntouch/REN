'use server';

import { cookies } from 'next/headers';
import { previewSeoTemplate, saveSeoSettings, SEO_SECTIONS, type SeoSection, type SeoTemplates, type TemplatePreview } from '@/domain/content/seo-settings';
import { requireStaff } from '@/domain/admin/staff-session';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../../_lib/run-action';

const BACK = '/admin/settings/seo';
const on = (form: FormData, name: string): boolean => field(form, name) === '1';

export async function saveSeoSettingsAction(form: FormData): Promise<never> {
  return runAction(BACK, async (session) => {
    const version = Number(field(form, 'version'));
    if (!Number.isInteger(version) || version < 0) throw new ValidationError('Форма устарела. Обновите страницу');
    const og = form.get('ogImage');
    const ogImage = og instanceof File && og.size > 0 ? { bytes: new Uint8Array(await og.arrayBuffer()) } : form.get('ogImage_clear') === '1' ? { remove: true as const } : undefined;
    await saveSeoSettings(session, {
      version,
      siteName: field(form, 'siteName'),
      description: field(form, 'description'),
      ogType: field(form, 'ogType'),
      canonicalHttps: on(form, 'canonicalHttps'),
      canonicalHost: field(form, 'canonicalHost'),
      robotsIndex: on(form, 'robotsIndex'),
      robotsDisallow: String(form.get('robotsDisallow') ?? ''),
      sitemapSections: Object.fromEntries(SEO_SECTIONS.map((s) => [s, on(form, `sitemap_${s}`)])) as Record<SeoSection, boolean>,
      changeFrequency: field(form, 'changeFrequency'),
      priority: field(form, 'priority'),
      templates: {
        productTitle: field(form, 'tpl_productTitle'),
        productDescription: field(form, 'tpl_productDescription'),
        categoryTitle: field(form, 'tpl_categoryTitle'),
        categoryDescription: field(form, 'tpl_categoryDescription'),
      },
      noindexFilters: on(form, 'noindexFilters'),
      noindexEmptyCategories: on(form, 'noindexEmptyCategories'),
      ogImage,
    });
  });
}

/** Предпросмотр шаблона на реальном товаре или категории (без сохранения). */
export async function previewSeoTemplateAction(kind: keyof SeoTemplates, template: string): Promise<TemplatePreview> {
  const session = requireStaff(await cookies());
  return previewSeoTemplate(session, { kind, template });
}
