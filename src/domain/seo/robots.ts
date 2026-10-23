import type { MetadataRoute } from 'next';
import { ROBOTS_DISALLOW } from './paths';

export function buildRobots(siteUrl: string): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...ROBOTS_DISALLOW] }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
