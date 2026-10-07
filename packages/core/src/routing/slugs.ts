/**
 * Localized conversion slugs and canonical paths.
 *
 *   en: /en/convert/jpg-to-png
 *   id: /id/convert/jpg-ke-png
 *
 * Format ids are lowercase alphanumeric (validated by the catalog), so splitting on the
 * separator is unambiguous. Parsing accepts aliases (`jpeg`), either separator and any case;
 * callers redirect non-canonical slugs to the canonical one so each page has exactly one URL
 * per locale.
 */
import type { Locale } from '../catalog/constants.ts';
import type { Registry } from '../registry/registry.ts';
import type { Conversion, Format } from '../registry/types.ts';

export const SLUG_SEPARATOR: Record<Locale, string> = { en: 'to', id: 'ke' };

export function conversionSlug(from: string, to: string, locale: Locale): string {
  return `${from}-${SLUG_SEPARATOR[locale]}-${to}`;
}

export interface ParsedConversionSlug {
  from: Format;
  to: Format;
  conversion: Conversion | undefined;
  /** The canonical slug for the requested locale. */
  canonical: string;
  /** Whether the given slug is already canonical for the locale. */
  isCanonical: boolean;
}

const SLUG_PATTERN = /^([a-z0-9.]+)-(to|ke)-([a-z0-9.]+)$/;

export function parseConversionSlug(
  slug: string,
  locale: Locale,
  registry: Registry,
): ParsedConversionSlug | null {
  const decoded = safeDecode(slug).trim().toLowerCase();
  const match = SLUG_PATTERN.exec(decoded);
  if (!match?.[1] || !match[3]) return null;
  const from = registry.resolveFormat(match[1]);
  const to = registry.resolveFormat(match[3]);
  if (!from || !to || from.id === to.id) return null;
  const canonical = conversionSlug(from.id, to.id, locale);
  return {
    from,
    to,
    conversion: registry.conversion(from.id, to.id),
    canonical,
    isCanonical: slug === canonical,
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Builders for every public page path. Keep URLs here so they never drift apart. */
export const paths = {
  home: (locale: Locale) => `/${locale}`,
  convertIndex: (locale: Locale) => `/${locale}/convert`,
  conversion: (locale: Locale, from: string, to: string) =>
    `/${locale}/convert/${conversionSlug(from, to, locale)}`,
  formats: (locale: Locale) => `/${locale}/formats`,
  format: (locale: Locale, id: string) => `/${locale}/formats/${id}`,
  category: (locale: Locale, id: string) => `/${locale}/categories/${id}`,
  tools: (locale: Locale) => `/${locale}/tools`,
  tool: (locale: Locale, id: string) => `/${locale}/tools/${id}`,
  search: (locale: Locale, query?: string) =>
    query ? `/${locale}/search?q=${encodeURIComponent(query)}` : `/${locale}/search`,
  privacy: (locale: Locale) => `/${locale}/privacy`,
  about: (locale: Locale) => `/${locale}/about`,
} as const;
