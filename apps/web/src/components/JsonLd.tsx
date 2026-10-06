import { jsonLd } from '@/server/seo.ts';

/** Structured data for search engines (escaped against script injection). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
