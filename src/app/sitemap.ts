import type { MetadataRoute } from 'next';
import { getSeoSettings, publicSiteUrl } from '@/domain/content/seo-settings';
import { listSitemapEntries, splitSitemap } from '@/domain/seo/sitemap';

// Читает БД: на сборке не вычислять.
export const dynamic = 'force-dynamic';

/**
 * Единственный файл /sitemap.xml (сейчас ~1,4 тыс. URL). Больше 50 000 — берём первый файл; чтобы разбить,
 * перейти на generateSitemaps (адреса станут /sitemap/N.xml — тогда обновить Sitemap: в robots.ts и в Яндекс/Google Вебмастере).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const seo = getSeoSettings();
  // Сайт закрыт от индексации в настройках SEO — карту сайта не отдаём.
  if (!seo.robotsIndex) return [];
  return splitSitemap(listSitemapEntries({ siteUrl: publicSiteUrl(), seo }))[0] ?? [];
}
