import type { MetadataRoute } from 'next';
import type { SeoSettings } from '@/domain/content/seo-settings';
import { ROBOTS_DISALLOW } from './paths';

/**
 * robots.txt. Настройки «SEO и метаданные»: индексирование выключено → весь сайт закрыт (Disallow: /, без sitemap);
 * иначе обязательные закрытые разделы + дополнительные пути из настроек.
 */
export function buildRobots(siteUrl: string, seo?: Pick<SeoSettings, 'robotsIndex' | 'robotsDisallow'>): MetadataRoute.Robots {
  if (seo && !seo.robotsIndex) return { rules: [{ userAgent: '*', disallow: '/' }] };
  const extra = (seo?.robotsDisallow ?? []).filter((p) => !(ROBOTS_DISALLOW as readonly string[]).includes(p));
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...ROBOTS_DISALLOW, ...extra] }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
