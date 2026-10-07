/**
 * sitemap.xml from the registry: only pages that may be indexed (offered, non-experimental
 * conversions and tools, formats with conversions), each with its language alternates.
 */
import type { MetadataRoute } from 'next';

import { paths } from '@vanillate/core';

import { LOCALE_TAGS, LOCALES, type Locale } from '@/i18n/config.ts';
import { absoluteUrl, siteRegistry } from '@/server/site.ts';

type Entry = MetadataRoute.Sitemap[number];

function entry(path: (locale: Locale) => string, priority: number): Entry[] {
  const languages = Object.fromEntries(
    LOCALES.map((locale) => [LOCALE_TAGS[locale], absoluteUrl(path(locale))]),
  );
  return LOCALES.map((locale) => ({
    url: absoluteUrl(path(locale)),
    priority,
    alternates: { languages },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const registry = siteRegistry();
  return [
    ...entry(paths.home, 1),
    ...entry(paths.convertIndex, 0.8),
    ...entry(paths.formats, 0.6),
    ...entry(paths.tools, 0.7),
    ...entry(paths.privacy, 0.3),
    ...entry(paths.about, 0.3),
    ...registry.visibleCategories().flatMap((c) => entry((l) => paths.category(l, c.id), 0.6)),
    ...registry
      .indexableConversions()
      .flatMap((c) => entry((l) => paths.conversion(l, c.from, c.to), 0.7)),
    ...registry
      .offeredTools()
      .filter((tool) => tool.indexable)
      .flatMap((tool) => entry((l) => paths.tool(l, tool.id), 0.7)),
    ...registry.formats
      .filter(
        (f) => registry.conversionsFrom(f.id).length + registry.conversionsTo(f.id).length > 0,
      )
      .flatMap((f) => entry((l) => paths.format(l, f.id), 0.5)),
  ];
}
