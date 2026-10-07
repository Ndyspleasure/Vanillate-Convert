import { describe, expect, it } from 'vitest';

import { compileRegistry } from './compile.ts';
import { catalog, getRegistry } from './default.ts';

const registry = getRegistry();

describe('registry compilation', () => {
  it('produces unique, offered routes for every offered conversion', () => {
    const ids = new Set<string>();
    for (const conversion of registry.conversions) {
      for (const route of conversion.routes) {
        expect(ids.has(route.id)).toBe(false);
        ids.add(route.id);
        expect(route.from).toBe(conversion.from);
        expect(route.to).toBe(conversion.to);
      }
      expect(conversion.offered).toBe(conversion.routes.some((r) => r.offered));
      if (conversion.offered) expect(conversion.routes[0]!.offered).toBe(true);
    }
  });

  it('never offers identity conversions unless a rule allows it', () => {
    for (const conversion of registry.conversions) expect(conversion.from).not.toBe(conversion.to);
  });

  it('prefers browser routes and keeps server routes as fallback (JPG → PNG)', () => {
    const conversion = registry.conversion('jpg', 'png')!;
    expect(conversion.modes).toEqual(['browser', 'server']);
    expect(conversion.routes[0]!.mode).toBe('browser');
    expect(
      conversion.routes.some((r) => r.mode === 'server' && r.engines.includes('imagemagick')),
    ).toBe(true);
  });

  it('routes HEIC to the server only', () => {
    const conversion = registry.conversion('heic', 'jpg')!;
    expect(conversion.modes).toEqual(['server']);
    expect(conversion.indexable).toBe(true);
  });

  it('derives limitations from format traits', () => {
    expect(registry.conversion('png', 'jpg')!.limitations).toEqual(
      expect.arrayContaining(['transparency-lost', 'lossy-output', 'metadata-removed']),
    );
    expect(registry.conversion('mp4', 'mp3')!.limitations).toEqual(
      expect.arrayContaining(['audio-only']),
    );
    expect(registry.conversion('json', 'csv')!.limitations).toEqual(
      expect.arrayContaining(['structure-flattened', 'types-as-text']),
    );
    expect(registry.conversion('ass', 'srt')!.limitations).toContain('styling-lost');
    expect(registry.conversion('mp3', 'wav')!.limitations).toContain('no-quality-restore');
    const pdfToPng = registry.conversion('pdf', 'png')!;
    expect(pdfToPng.limitations).toContain('one-file-per-page');
    expect(pdfToPng.routes[0]!.cardinality).toBe('1:n');
  });

  it('orders warnings before informational limitations', () => {
    const ids = registry.conversion('png', 'jpg')!.limitations;
    const severities = ids.map((id) => registry.limitation(id)!.severity);
    expect(severities.indexOf('info')).toBeGreaterThan(severities.lastIndexOf('warning'));
  });

  it('narrows options per target (container-specific video codecs)', () => {
    const webm = registry.conversion('mp4', 'webm')!.routes[0]!;
    const codec = webm.options.find((o) => o.id === 'videoCodec')!;
    expect(codec.choices!.map((c) => c.value)).toEqual(['vp9', 'av1']);
    expect(codec.default).toBe('vp9');
    const gif = registry.conversion('mp4', 'gif')!.routes[0]!;
    expect(gif.options.find((o) => o.id === 'fps')!.default).toBe(10);
    expect(gif.options.find((o) => o.id === 'width')!.max).toBe(1280);
  });

  it('expands multi-step pipelines with intermediate formats', () => {
    const route = registry.conversion('docx', 'png')!.routes[0]!;
    expect(route.steps).toEqual([
      { engine: 'libreoffice', from: 'docx', to: 'pdf' },
      { engine: 'poppler', from: 'pdf', to: 'png' },
    ]);
    expect(route.pool).toBe('document');
  });

  it('excludes meaningless pairs', () => {
    expect(registry.conversion('jsonl', 'ndjson')).toBeUndefined();
    expect(registry.conversion('ttml', 'dfxp')).toBeUndefined();
    expect(registry.conversion('ttf', 'otf')).toBeUndefined();
  });

  it('caps status by engine status and format status', () => {
    expect(registry.conversion('obj', 'stl')!.status).toBe('experimental');
    expect(registry.conversion('cr2', 'jpg')!.status).toBe('experimental');
    expect(registry.conversion('cr2', 'jpg')!.indexable).toBe(false);
  });
});

describe('registry environments', () => {
  it('drops server routes when server processing is disabled', () => {
    const browserOnly = getRegistry({ disabledModes: ['server'] });
    expect(browserOnly.conversion('heic', 'jpg')!.offered).toBe(false);
    expect(browserOnly.conversion('jpg', 'png')!.modes).toEqual(['browser']);
    expect(browserOnly.format('heic')!.readable).toBe(false);
    expect(browserOnly.tool('pdf-compressor')!.offered).toBe(false);
    expect(browserOnly.tool('json-formatter')!.offered).toBe(true);
    for (const conversion of browserOnly.offeredConversions())
      expect(conversion.modes).toEqual(['browser']);
  });

  it('applies forced engine statuses', () => {
    const degraded = compileRegistry(catalog, { engineStatus: { libreoffice: 'degraded' } });
    expect(degraded.conversion('docx', 'pdf')!.status).toBe('limited');
    const disabled = compileRegistry(catalog, { engineStatus: { libreoffice: 'disabled' } });
    expect(disabled.conversion('docx', 'pdf')!.offered).toBe(false);
    // Pandoc still converts DOCX to Markdown.
    expect(disabled.conversion('docx', 'md')!.offered).toBe(true);
  });

  it('memoizes registries per environment', () => {
    expect(getRegistry()).toBe(getRegistry({}));
    expect(getRegistry({ disabledModes: ['server'] })).toBe(
      getRegistry({ disabledModes: ['server'] }),
    );
  });
});

describe('registry lookups', () => {
  it('resolves ids, aliases and extensions case-insensitively', () => {
    expect(registry.resolveFormat('JPEG')!.id).toBe('jpg');
    expect(registry.resolveFormat('.Tif')!.id).toBe('tiff');
    expect(registry.resolveFormat('mts')!.id).toBe('m2ts');
    expect(registry.resolveFormat('yml')!.id).toBe('yaml');
    expect(registry.resolveFormat('tar.gz')!.id).toBe('tgz');
    expect(registry.resolveFormat('unknown')).toBeUndefined();
  });

  it('indexes formats by extension and MIME type, most popular first', () => {
    expect(registry.formatsByExtension('m4a').map((f) => f.id)).toEqual(['m4a', 'alac']);
    expect(registry.formatsByMime('image/jpeg; charset=binary').map((f) => f.id)).toEqual(['jpg']);
  });

  it('lists conversions from a format by target popularity', () => {
    const targets = registry.conversionsFrom('png').map((c) => c.to);
    expect(targets[0]).toBe('jpg');
    expect(targets).toContain('webp');
    expect(targets).not.toContain('png');
  });

  it('derives per-mode format support', () => {
    expect(registry.format('jpg')!.support).toEqual({ browser: 'stable', server: 'stable' });
    expect(registry.format('heic')!.support.browser).toBeNull();
    expect(registry.format('fits')!.readable).toBe(true);
    expect(registry.format('netcdf')!.readable).toBe(false);
  });

  it('merges category limits over defaults', () => {
    const video = registry.limitsFor('server', 'video');
    expect(video.maxInputBytes).toBe(2 * 1024 ** 3);
    expect(video.maxFilesPerJob).toBe(registry.limitsFor('server', 'image').maxFilesPerJob);
    expect(registry.limitsFor('browser', 'subtitle').maxInputBytes).toBe(10 * 1024 ** 2);
  });

  it('exposes only offered popular entries', () => {
    const popular = registry.popular();
    expect(popular.conversions.length).toBeGreaterThanOrEqual(15);
    for (const conversion of popular.conversions) expect(conversion.offered).toBe(true);
    const browserOnly = getRegistry({ disabledModes: ['server'] }).popular();
    expect(browserOnly.conversions.map((c) => c.key)).not.toContain('heic:jpg');
  });

  it('hides empty categories from navigation', () => {
    expect(registry.visibleCategories().map((c) => c.id)).not.toContain('specialized');
    expect(registry.category('image')!.relatedFormatIds).toContain('svg');
  });
});
