import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseProbe, videoFilters } from '../src/engines/ffmpeg.ts';
import { publicMetadata } from '../src/engines/exiftool.ts';
import { parsePam, POLICY_XML } from '../src/engines/imagemagick.ts';
import { EXPORT_FILTERS, IMPORT_FILTERS } from '../src/engines/libreoffice.ts';
import { parsePdfInfo } from '../src/engines/poppler.ts';
import { rasterSize, svgSize } from '../src/engines/rsvg.ts';
import { checkListing, parseListing, safeEntryPath } from '../src/engines/sevenzip.ts';
import { SERVER_ENGINES } from '../src/index.ts';
import { pageRuns, rangeText, selectedPages } from '../src/util.ts';
import { makeJob, registry } from './helpers.ts';

describe('engine registry', () => {
  it('has an adapter for every server engine in the catalog', () => {
    const serverEngines = registry.engines.filter((e) => e.mode === 'server').map((e) => e.id);
    expect(Object.keys(SERVER_ENGINES).sort()).toEqual(serverEngines.sort());
  });

  it('LibreOffice filters cover every format the catalog lets it read and write', () => {
    const engine = registry.engine('libreoffice');
    for (const format of engine?.read ?? []) expect(IMPORT_FILTERS[format], format).toBeDefined();
    const writable = new Set(Object.values(EXPORT_FILTERS).flatMap((f) => Object.keys(f)));
    for (const format of engine?.write ?? []) expect(writable.has(format), format).toBe(true);
  });
});

describe('page helpers', () => {
  it('groups pages into runs and range text', () => {
    expect(pageRuns([1, 2, 3, 5, 7, 8])).toEqual([
      [1, 3],
      [5, 5],
      [7, 8],
    ]);
    expect(rangeText([1, 2, 3, 5])).toBe('1-3,5');
  });

  it('selects pages from the option and enforces limits', () => {
    expect(selectedPages('', 3, 10)).toEqual([1, 2, 3]);
    expect(selectedPages(' 2-9 ', 3, 10)).toEqual([2, 3]);
    expect(() => selectedPages('5', 3, 10)).toThrow(/page-range-invalid/);
    expect(() => selectedPages('x', 3, 10)).toThrow(/page-range-invalid/);
    expect(() => selectedPages('', 30, 10)).toThrow(/too-many-pages/);
  });
});

describe('ffprobe parsing', () => {
  it('reads streams defensively', () => {
    const info = parseProbe(
      JSON.stringify({
        format: { duration: '12.5' },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'mjpeg',
            width: 300,
            height: 300,
            avg_frame_rate: '0/0',
            disposition: { attached_pic: 1 },
          },
          {
            index: 1,
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30000/1001',
          },
          {
            index: 2,
            codec_type: 'audio',
            codec_name: 'aac',
            sample_rate: '48000',
            channels: 6,
            bits_per_raw_sample: '24',
          },
          'garbage',
        ],
      }),
    );
    expect(info.duration).toBe(12.5);
    expect(info.streams[0]?.attachedPic).toBe(true);
    expect(info.streams[1]?.frameRate).toBeCloseTo(29.97, 2);
    expect(info.streams[1]?.frameRateText).toBe('30000/1001');
    expect(info.streams[2]).toMatchObject({ sampleRate: 48000, channels: 6, bits: 24 });
    expect(parseProbe('{}').duration).toBeNull();
    expect(() => parseProbe('not json')).toThrow(/input-corrupt/);
  });

  it('builds filter graphs with even dimensions and no upscaling', () => {
    expect(videoFilters(0, null, false, 'yuv420p')).toBe(
      "scale='trunc(iw/2)*2':'trunc(ih/2)*2',format=yuv420p",
    );
    expect(videoFilters(720, '25', false, 'yuv420p')).toBe(
      "scale=-2:'min(720,trunc(ih/2)*2)',fps=25,format=yuv420p",
    );
    expect(videoFilters(0, null, true, 'yuv420p')).toMatch(
      /drawbox=.*c=white@1.*overlay=format=auto,scale=.*\[v\]$/,
    );
  });
});

describe('ImageMagick policy', () => {
  it('embeds exactly the policy file that worker images install', async () => {
    const file = await readFile(
      join(import.meta.dirname, '..', 'config', 'imagemagick', 'policy.xml'),
      'utf8',
    );
    expect(POLICY_XML).toBe(file);
    expect(POLICY_XML).toContain('<policy domain="delegate" rights="none" pattern="*"/>');
  });
});

describe('PAM and pdfinfo parsing', () => {
  it('parses a PAM header', () => {
    const header = new TextEncoder().encode(
      'P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n',
    );
    expect(parsePam(header)).toEqual({ width: 3, height: 2, offset: header.length });
    expect(() => parsePam(new TextEncoder().encode('P6\n3 2\n255\n'))).toThrow(/conversion-failed/);
  });

  it('parses pdfinfo output', () => {
    const info = parsePdfInfo(
      'Title: x\nPages:          3\nPage    1 size: 612 x 792 pts (letter)\nPage    2 size: 595.28 x 841.89 pts (A4)\n',
    );
    expect(info.pages).toBe(3);
    expect(info.sizes.get(2)).toEqual({ width: 595.28, height: 841.89 });
    expect(() => parsePdfInfo('nothing')).toThrow(/input-corrupt/);
  });
});

describe('SVG sizing', () => {
  it('reads the declared size from width/height or the viewBox', () => {
    const cm = svgSize('<svg width="10cm" height="5cm">');
    expect(cm?.width).toBeCloseTo((10 * 96) / 2.54, 6);
    expect(cm?.height).toBeCloseTo((5 * 96) / 2.54, 6);
    expect(svgSize("<svg viewBox='0 0 300 150'>")).toEqual({ width: 300, height: 150 });
    expect(svgSize('<svg width="600" viewBox="0 0 300 150">')).toEqual({ width: 600, height: 300 });
    expect(svgSize('<svg width="100%">')).toBeNull();
    expect(svgSize('<html>')).toBeNull();
  });

  it('caps huge canvases and keeps the aspect ratio', () => {
    const size = rasterSize(
      { width: 200_000, height: 100_000 },
      { width: 0, height: 0 },
      100_000_000,
    );
    expect(size.width).toBeLessThanOrEqual(16384);
    expect(size.width * size.height).toBeLessThanOrEqual(100_000_000);
    expect(size.width / size.height).toBeCloseTo(2, 1);
    expect(rasterSize({ width: 100, height: 50 }, { width: 400, height: 0 }, 1e8)).toEqual({
      width: 400,
      height: 200,
    });
  });
});

describe('7-Zip listing checks', () => {
  const listing = (blocks: string[]) => parseListing(blocks.join('\n\n'));

  it('parses entries, links and encryption', () => {
    const entries = listing([
      'Path = a/b.txt\nFolder = -\nSize = 5\nAttributes = A_ -rw-r--r--',
      'Path = a\nFolder = +\nSize = 0',
      'Path = link\nFolder = -\nSize = 11\nMode = lrw-r--r--\nSymbolic Link = /etc/passwd',
      'Path = secret.txt\nFolder = -\nSize = 3\nEncrypted = +',
    ]);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      path: 'a/b.txt',
      folder: false,
      size: 5,
      unsafeType: false,
    });
    expect(entries[1]?.folder).toBe(true);
    expect(entries[2]?.unsafeType).toBe(true);
    expect(entries[3]?.encrypted).toBe(true);
  });

  it('rejects traversal and control characters but normalizes absolute paths', () => {
    expect(safeEntryPath('/abs/x.txt', 100)).toBe('abs/x.txt');
    expect(safeEntryPath('C:\\dir\\x.txt', 100)).toBe('dir/x.txt');
    expect(() => safeEntryPath('../x', 100)).toThrow(/archive-unsafe/);
    expect(() => safeEntryPath('a/../../x', 100)).toThrow(/archive-unsafe/);
    expect(() => safeEntryPath('a\u0001b', 100)).toThrow(/archive-unsafe/);
    expect(() => safeEntryPath('x'.repeat(101), 100)).toThrow(/archive-unsafe/);
  });

  it('enforces entry count, expanded size and ratio limits', async () => {
    const job = await makeJob({
      limits: {
        archive: {
          maxEntries: 2,
          maxExtractedBytes: 500_000_000,
          maxCompressionRatio: 100,
          maxPathLength: 100,
          maxDepth: 0,
        },
      },
    });
    try {
      const file = (path: string, size: number) => ({
        path,
        folder: false,
        size,
        encrypted: false,
        unsafeType: false,
      });
      expect(() => checkListing([file('a', 1), file('b', 1)], 10, job.ctx)).not.toThrow();
      expect(() => checkListing([file('a', 1), file('b', 1), file('c', 1)], 10, job.ctx)).toThrow(
        /archive-too-large/,
      );
      expect(() => checkListing([file('a', 400_000_000)], 1_000_000, job.ctx)).toThrow(
        /archive-too-large/,
      );
      expect(() => checkListing([file('a', 600_000_000)], 100_000_000, job.ctx)).toThrow(
        /archive-too-large/,
      );
      expect(() => checkListing([{ ...file('a', 1), encrypted: true }], 10, job.ctx)).toThrow(
        /password-protected/,
      );
    } finally {
      await job.cleanup();
    }
  });
});

describe('ExifTool output', () => {
  it('drops server-side details', () => {
    expect(
      publicMetadata([
        {
          SourceFile: '/var/lib/vanillate/jobs/job_x/in/in_y',
          'System:FileName': 'in_y',
          'File:Directory': '/var/lib',
          'ExifTool:ExifToolVersion': 12.76,
          'File:MIMEType': 'image/jpeg',
          'GPS:GPSLatitude': '12 deg',
        },
      ]),
    ).toEqual({ 'File:MIMEType': 'image/jpeg', 'GPS:GPSLatitude': '12 deg' });
  });
});
