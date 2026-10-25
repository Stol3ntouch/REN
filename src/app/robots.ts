import type { MetadataRoute } from 'next';
import { getSeoSettings, publicSiteUrl } from '@/domain/content/seo-settings';
import { buildRobots } from '@/domain/seo/robots';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return buildRobots(publicSiteUrl(), getSeoSettings());
}
