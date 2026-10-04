import { describe, expect, it } from 'vitest';

import { getRegistry } from '../registry/default.ts';
import { selectRoute } from './select.ts';
import { conversionSlug, parseConversionSlug, paths } from './slugs.ts';

const registry = getRegistry();

describe('conversion slugs', () => {
  it('builds localized slugs', () => {
    expect(conversionSlug('jpg', 'png', 'en')).toBe('jpg-to-png');
    expect(conversionSlug('jpg', 'png', 'id')).toBe('jpg-ke-png');
    expect(paths.conversion('id', 'heic', 'jpg')).toBe('/id/convert/heic-ke-jpg');
  });

  it('parses canonical slugs', () => {
    const parsed = parseConversionSlug('jpg-to-png', 'en', registry)!;
    expect(parsed.from.id).toBe('jpg');
    expect(parsed.to.id).toBe('png');
    expect(parsed.isCanonical).toBe(true);
    expect(parsed.conversion?.offered).toBe(true);
  });

  it('accepts aliases, case and the other separator, and points to the canonical slug', () => {
    const parsed = parseConversionSlug('JPEG-to-PNG', 'id', registry)!;
    expect(parsed.canonical).toBe('jpg-ke-png');
    expect(parsed.isCanonical).toBe(false);
    expect(parseConversionSlug('tar.gz-to-zip', 'en', registry)?.canonical).toBe('tgz-to-zip');
  });

  it('rejects malformed or unknown slugs', () => {
    expect(parseConversionSlug('jpg', 'en', registry)).toBeNull();
    expect(parseConversionSlug('jpg-to-jpg', 'en', registry)).toBeNull();
    expect(parseConversionSlug('foo-to-bar', 'en', registry)).toBeNull();
    expect(parseConversionSlug('%E0%A4%A', 'en', registry)).toBeNull();
  });
});

describe('selectRoute', () => {
  const jpgToPng = registry.conversion('jpg', 'png')!;
  const mb = 1024 * 1024;

  it('prefers the browser route for small files', () => {
    const selection = selectRoute(
      jpgToPng.routes,
      'image',
      [{ size: 2 * mb }],
      { serverAvailable: true },
      registry,
    );
    expect(selection.ok && selection.mode).toBe('browser');
  });

  it('falls back to the server when the browser cannot handle the file', () => {
    const unsupported = selectRoute(
      jpgToPng.routes,
      'image',
      [{ size: 2 * mb }],
      { serverAvailable: true, browserSupports: () => false },
      registry,
    );
    expect(unsupported.ok && unsupported.mode).toBe('server');
  });

  it('reports the most helpful reason when nothing fits', () => {
    const tooBig = selectRoute(
      jpgToPng.routes,
      'image',
      [{ size: 500 * mb }],
      { serverAvailable: false },
      registry,
    );
    expect(tooBig).toEqual({ ok: false, code: 'file-too-large' });
    const heic = registry.conversion('heic', 'jpg')!;
    const noServer = selectRoute(
      heic.routes,
      'image',
      [{ size: mb }],
      { serverAvailable: false },
      registry,
    );
    expect(noServer).toEqual({ ok: false, code: 'server-processing-disabled' });
    const empty = selectRoute(
      jpgToPng.routes,
      'image',
      [{ size: 0 }],
      { serverAvailable: true },
      registry,
    );
    expect(empty).toEqual({ ok: false, code: 'file-empty' });
  });

  it('honours a preferred mode', () => {
    const selection = selectRoute(
      jpgToPng.routes,
      'image',
      [{ size: mb }],
      { serverAvailable: true, preferMode: 'server' },
      registry,
    );
    expect(selection.ok && selection.mode).toBe('server');
  });
});
