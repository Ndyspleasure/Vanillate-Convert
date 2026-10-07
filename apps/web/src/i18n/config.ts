/**
 * Locale configuration and negotiation. Pure functions: shared by the proxy, server pages and
 * client components.
 */
import { LOCALES, SLUG_SEPARATOR, type Locale } from '@vanillate/core';

export { LOCALES, type Locale };

/** Fallback for visitors whose languages we don't support. */
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'vc-locale';

export const LOCALE_NAMES: Record<Locale, string> = { id: 'Bahasa Indonesia', en: 'English' };
/** BCP 47 tags for `<html lang>`, hreflang and `Intl`. */
export const LOCALE_TAGS: Record<Locale, string> = { id: 'id-ID', en: 'en' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Maps a language tag to a supported locale (`in` is the legacy code for Indonesian). */
function localeOfTag(tag: string): Locale | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (primary === 'id' || primary === 'in') return 'id';
  if (primary === 'en') return 'en';
  return null;
}

/** Chooses a locale from a saved preference, then `Accept-Language`, then the default. */
export function negotiateLocale(acceptLanguage: string | null, saved?: string | null): Locale {
  if (isLocale(saved)) return saved;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { tag, q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => entry.tag.trim() !== '' && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const entry of ranked) {
    const locale = localeOfTag(entry.tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * The same page in another locale. Conversion slugs are localized (`jpg-to-png` ↔
 * `jpg-ke-png`); everything else only changes the locale prefix.
 */
export function localizePath(pathname: string, target: Locale): string {
  const [, first = '', ...rest] = pathname.split('/');
  const segments = isLocale(first) ? rest : [first, ...rest].filter((s) => s !== '');
  if (segments[0] === 'convert' && segments[1]) {
    const match = /^([a-z0-9.]+)-(?:to|ke)-([a-z0-9.]+)$/.exec(segments[1]);
    if (match) segments[1] = `${match[1]}-${SLUG_SEPARATOR[target]}-${match[2]}`;
  }
  return `/${[target, ...segments].join('/')}`.replace(/\/$/, '');
}
