import type { MetadataRoute } from 'next';
import { buildRobots } from '@/domain/seo/robots';
import { resolveSiteUrl } from '@/domain/seo/site-url';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return buildRobots(resolveSiteUrl());
}
