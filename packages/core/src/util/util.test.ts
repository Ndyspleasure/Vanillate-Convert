import { describe, expect, it } from 'vitest';

import { getRegistry } from '../registry/default.ts';
import { search } from '../search/search.ts';
import { formatBytes } from './bytes.ts';
import { contentDisposition, outputFilename, sanitizeFilename } from './filename.ts';
import { fromBase64Url, newId, newToken, sha256Hex, timingSafeEqual, toBase64Url } from './ids.ts';
import { createLogger, redact } from './logger.ts';

describe('filenames', () => {
  it('strips paths, control characters and reserved names', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\me\\photo.jpg')).toBe('photo.jpg');
    expect(sanitizeFilename('a\u0000b<c>.png')).toBe('a_b_c_.png');
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFilename('   ')).toBe('file');
    expect(sanitizeFilename('photo\u202Egpj.exe')).toBe('photo_gpj.exe');
  });

  it('limits long names and keeps the extension', () => {
    const name = sanitizeFilename(`${'é'.repeat(300)}.jpeg`);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(180);
    expect(name.endsWith('.jpeg')).toBe(true);
  });

  it('builds output names', () => {
    const registry = getRegistry();
    const png = registry.format('png')!;
    expect(outputFilename('holiday.heic', png)).toBe('holiday.png');
    expect(outputFilename('slides.pptx', png, { index: 2, total: 12 })).toBe('slides-003.png');
    expect(outputFilename('backup.tar.gz', registry.format('zip')!, undefined, ['tar.gz'])).toBe(
      'backup.zip',
    );
    expect(outputFilename('', png)).toBe('file.png');
  });

  it('encodes Content-Disposition safely', () => {
    expect(contentDisposition('résumé "final".pdf')).toBe(
      `attachment; filename="r_sum_ _final_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20_final_.pdf`,
    );
  });
});

describe('ids and tokens', () => {
  it('creates prefixed random ids and tokens', () => {
    expect(newId('job')).toMatch(/^job_[a-z2-7]{26}$/);
    expect(newId('job')).not.toBe(newId('job'));
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('round-trips base64url and hashes', async () => {
    const bytes = new Uint8Array([0, 255, 128, 62, 63]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
  });
});

describe('logger', () => {
  it('redacts secrets and signed URL parameters', () => {
    expect(redact({ token: 'abc', nested: { apiKey: 'x', ok: 1 } })).toEqual({
      token: '[redacted]',
      nested: { apiKey: '[redacted]', ok: 1 },
    });
    expect(redact('https://s3/x?X-Amz-Signature=abc&part=1')).toBe(
      'https://s3/x?X-Amz-Signature=[redacted]&part=1',
    );
  });

  it('writes JSON lines above the configured level', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'info', sink: (line) => lines.push(line) }).child({
      jobId: 'job_1',
    });
    logger.debug('hidden');
    logger.info('job.created', { authorization: 'Bearer x' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'info',
      event: 'job.created',
      jobId: 'job_1',
      authorization: '[redacted]',
    });
  });
});

describe('formatBytes', () => {
  it('formats binary sizes per locale', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1536, 'id')).toBe('1,5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
  });
});

describe('search', () => {
  const registry = getRegistry();

  it('understands "A to B" in both languages', () => {
    for (const query of ['heic to jpg', 'HEIC ke JPG', 'convert heic jpg', 'heic → jpeg']) {
      const [first] = search(query, registry, 'en');
      expect(first?.type).toBe('conversion');
      expect(first?.type === 'conversion' && first.conversion.key).toBe('heic:jpg');
    }
  });

  it('finds formats by alias and their conversions', () => {
    const results = search('word', registry, 'en');
    expect(results[0]?.type === 'format' && results[0].format.id).toBe('docx');
    expect(results.some((r) => r.type === 'conversion' && r.conversion.from === 'docx')).toBe(true);
  });

  it('finds tools by localized names', () => {
    expect(
      search('compress pdf', registry, 'en').some(
        (r) => r.type === 'tool' && r.tool.id === 'pdf-compressor',
      ),
    ).toBe(true);
    expect(
      search('kompres pdf', registry, 'id').some(
        (r) => r.type === 'tool' && r.tool.id === 'pdf-compressor',
      ),
    ).toBe(true);
    expect(search('gabung pdf', registry, 'id')[0]?.type).toBe('tool');
  });

  it('returns nothing for empty queries and only offered entries', () => {
    expect(search('   ', registry, 'en')).toEqual([]);
    const browserOnly = getRegistry({ disabledModes: ['server'] });
    expect(search('heic to jpg', browserOnly, 'en').some((r) => r.type === 'conversion')).toBe(
      false,
    );
  });
});
