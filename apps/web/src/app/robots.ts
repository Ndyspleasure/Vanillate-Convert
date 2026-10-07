import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/server/site.ts';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/*/search'] }],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
