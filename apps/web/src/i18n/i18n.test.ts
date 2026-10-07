import { describe, expect, it } from 'vitest';

import { PROCESSING_MODES, STATUSES } from '@vanillate/core';

import { LOCALES, localizePath, negotiateLocale } from './config.ts';
import { format, getMessages, type Messages } from './messages.ts';

/** `section.key` → string, for every leaf of a dictionary. */
function leaves(value: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, leaf] of leaves(child, prefix ? `${prefix}.${key}` : key))
        out.set(path, leaf);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

describe('dictionaries', () => {
  const reference = leaves(getMessages('en'));

  it.each(LOCALES)('%s has exactly the same keys as en, all non-empty strings', (locale) => {
    const dictionary = leaves(getMessages(locale));
    expect([...dictionary.keys()].sort()).toEqual([...reference.keys()].sort());
    for (const [key, text] of dictionary) {
      expect(typeof text, key).toBe('string');
      expect((text as string).trim(), key).not.toBe('');
    }
  });

  it.each(LOCALES)('%s uses the same placeholders as en', (locale) => {
    const dictionary = leaves(getMessages(locale));
    for (const [key, text] of reference) {
      expect(placeholders(dictionary.get(key) as string), key).toEqual(
        placeholders(text as string),
      );
    }
  });

  it.each(LOCALES)('%s names every conversion status and processing mode', (locale) => {
    const t: Messages = getMessages(locale);
    expect(Object.keys(t.status).sort()).toEqual([...STATUSES].sort());
    expect(Object.keys(t.conversion.statusText).sort()).toEqual([...STATUSES].sort());
    expect(Object.keys(t.mode).sort()).toEqual([...PROCESSING_MODES].sort());
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(format('{from} to {to}', { from: 'JPG', to: 'PNG' })).toBe('JPG to PNG');
    expect(format('{count} files', { count: 3 })).toBe('3 files');
    expect(format('{missing} stays')).toBe('{missing} stays');
  });

  it('does not read inherited properties', () => {
    expect(format('{toString}', {})).toBe('{toString}');
  });
});

describe('negotiateLocale', () => {
  it('prefers a saved choice', () => {
    expect(negotiateLocale('en-US,en;q=0.9', 'id')).toBe('id');
  });

  it('ignores an invalid saved value', () => {
    expect(negotiateLocale('id-ID', 'fr')).toBe('id');
    expect(negotiateLocale(null, '../../etc')).toBe('en');
  });

  it('follows Accept-Language order and quality', () => {
    expect(negotiateLocale('id-ID,id;q=0.9,en-US;q=0.8')).toBe('id');
    expect(negotiateLocale('en;q=0.4,id;q=0.8')).toBe('id');
    expect(negotiateLocale('fr-FR,en;q=0.5,id;q=0.3')).toBe('en');
  });

  it('understands the legacy code for Indonesian', () => {
    expect(negotiateLocale('in-ID')).toBe('id');
  });

  it('skips refused languages and falls back to English', () => {
    expect(negotiateLocale('id;q=0, fr')).toBe('en');
    expect(negotiateLocale('')).toBe('en');
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale('*')).toBe('en');
  });
});

describe('localizePath', () => {
  it('swaps the locale prefix', () => {
    expect(localizePath('/en/formats/pdf', 'id')).toBe('/id/formats/pdf');
    expect(localizePath('/id', 'en')).toBe('/en');
    expect(localizePath('/en/', 'id')).toBe('/id');
  });

  it('localizes conversion slugs', () => {
    expect(localizePath('/en/convert/jpg-to-png', 'id')).toBe('/id/convert/jpg-ke-png');
    expect(localizePath('/id/convert/jpg-ke-png', 'en')).toBe('/en/convert/jpg-to-png');
    expect(localizePath('/en/convert', 'id')).toBe('/id/convert');
  });

  it('adds a prefix to paths without one', () => {
    expect(localizePath('/', 'id')).toBe('/id');
    expect(localizePath('/convert/heic-to-jpg', 'id')).toBe('/id/convert/heic-ke-jpg');
    expect(localizePath('/privacy/', 'en')).toBe('/en/privacy');
  });
});
