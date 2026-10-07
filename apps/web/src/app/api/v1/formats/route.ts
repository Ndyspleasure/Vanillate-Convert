/** GET /api/v1/formats — the format registry of this deployment (public, cacheable). */
import { siteRegistry } from '@/server/site.ts';

export const dynamic = 'force-static';

export function GET(): Response {
  const formats = siteRegistry().formats.map((format) => ({
    id: format.id,
    label: format.label,
    name: format.name,
    category: format.category,
    extensions: format.extensions,
    mimeTypes: format.mimeTypes,
    readable: format.readable,
    writable: format.writable,
    support: format.support,
  }));
  return Response.json({ formats });
}
